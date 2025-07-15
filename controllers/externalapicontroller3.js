const express = require('express');
const { OpenAIEmbeddings, ChatOpenAI } = require('@langchain/openai');
const { TextLoader } = require('langchain/document_loaders/fs/text');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const { MemoryVectorStore } = require('langchain/vectorstores/memory');
const { PromptTemplate } = require('@langchain/core/prompts');
const { RunnableSequence, RunnablePassthrough } = require('@langchain/core/runnables');
const { StringOutputParser } = require('@langchain/core/output_parsers');

// Global variables for RAG components
let ragChain = null;
let isInitialized = false;



// Scrabble letter points
const LETTER_POINTS = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10
};

// Calculate word points
const calculatePoints = (word) => {
    return word.split('').reduce( (total, letter) => {
        return total + (LETTER_POINTS[letter.toUpperCase()] || 0)
    },0)
}

// Check if a word can be formed from given letters
const canFormWord = (word, availableLetters) => {
    let letterCount = {}
     
    //count available letters
    for ( const letter of availableLetters.toUpperCase() ) {
        letterCount[letter] = (letterCount[letter] || 0) + 1
    }

    //check if word can be formed
    for ( const letter of word.toUpperCase() ){
        if( !letterCount[letter] || letterCount[letter] == 0 ){
            return false
        }
        letterCount[letter]--

    }
    
    return true
}



// Initialize RAG Chain using LCEL (modern approach)
const initializeRAGChain = async () => {
  try {
    if (isInitialized) return;

    console.log('Initializing modern RAG chain for Scrabble dictionary...');

    // const loader = new PDFLoader(pdfPath);
    // const docs = await loader.load();
    
    // const textSplitter = new RecursiveCharacterTextSplitter({
    //   chunkSize: 1000,
    //   chunkOverlap: 200, // Overlap for context continuity
    // });
    
    // const splitDocs = await textSplitter.splitDocuments(docs);

    // 1. Load Scrabble dictionary
    const loader = new TextLoader('./scrabble.txt');
    const rawDocs = await loader.load();

    // 2. Split the document - each word should be its own chunk
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 50,  // Small chunks since we want individual words
      chunkOverlap: 0,
      separators: ['\n', ' '], // Split by newlines and spaces
    });
    const splitDocs = await splitter.splitDocuments(rawDocs);
    
    // 3. Create embeddings and vector store
    const embeddings = new OpenAIEmbeddings({ 
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: "text-embedding-3-small"
    });
    
    const vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, embeddings);
    const retriever = vectorStore.asRetriever({
      k: 100, // Retrieve more words for better coverage
      searchType: "similarity"
    });

    // 4. Create prompt template
    const promptTemplate = PromptTemplate.fromTemplate(`
    You are a Scrabble word expert. Using the provided dictionary context, find ALL valid words that can be formed from the given letters.

    Context from Scrabble dictionary:
    {context}

    Query: {question}

    STRICT REQUIREMENTS:
    - Each letter can only be used once per word
    - Only use words that appear in the provided context
    - List words in UPPERCASE format, one per line
    - No explanations, just the words
    - Include all valid word forms (plurals, verb forms, etc.)

    Valid words:
    `);

    // 5. Create LLM
    const llm = new ChatOpenAI({ 
      openAIApiKey: process.env.OPENAI_API_KEY, 
      temperature: 0.1,
      modelName: "gpt-4o-mini"
    });

    // 6. Create RAG chain using LCEL
    ragChain = RunnableSequence.from([
      {
        context: retriever,
        question: new RunnablePassthrough()
      },
      promptTemplate,
      llm,
      new StringOutputParser()
    ]);

    isInitialized = true;
    console.log('Modern RAG chain initialized successfully!');

  } catch (error) {
    console.error('Error initializing RAG chain:', error);
    throw error;
  }
};


// Parse words from RAG response
const parseWordsFromResponse = (response, letters, minLength, maxLength) => {
  // Extract words from the response text
 
  const words = response.match(/\b[A-Z]{2,}\b/g) || [];
 
  return words
    .filter(word => {
      return word.length >= minLength && 
             word.length <= maxLength && 
             canFormWord(word, letters);
    })
    .map(word => word.toUpperCase());
};



const findScrabbleWords = async (req,res) => {

    try {      
        const { letters, minLength = 2, maxLength = 15, includeDefinitions } = req.body;
    
        if (!letters || typeof letters !== 'string') {
           return res.status(400).json({ error: 'Letters parameter is required and must be a string' });
        }
        
        if (letters.length > 15) {
           return res.status(400).json({ error: 'Maximum 15 letters allowed' });
        }

        if (letters.length < minLength) {
           return res.status(400).json({ error: 'Not enough letters provided' });
        }


         // Initialize RAG chain if not already done
        await initializeRAGChain();

        if (!ragChain) {
           return res.status(500).json({ error: 'RAG chain not initialized yet' });
        }

        // Create comprehensive query for the RAG chain
        const query = `Find all valid Scrabble words that can be formed using the letters "${letters.toUpperCase()}". 
        
        REQUIREMENTS:
        - Each letter can only be used once per word
        - Minimum word length: ${minLength} letters
        - Maximum word length: ${Math.min(maxLength, letters.length)} letters
        - Only include words from the official Scrabble dictionary
        - Available letters: ${letters.toUpperCase().split('').join(', ')}
        - Letter frequency: ${JSON.stringify(letters.toUpperCase().split('').reduce((acc, letter) => {
        acc[letter] = (acc[letter] || 0) + 1;
        return acc;
        }, {}))}

        Provide words only, no explanations, no numbering, no additional text.
        Try to find at least 5-15 words if possible.
        
        Letters to use: ${letters.toUpperCase()}`;
        

        console.log('Querying modern RAG chain for words...');

        // Query the RAG chain using LCEL
        const result = await ragChain.invoke(query);
        
        console.log('RAG Response received');

        console.log('Response:', result); 

        // Parse words from the response
        let foundWords = parseWordsFromResponse(
            result, // result is now a string directly
            letters, 
            minLength, 
            Math.min(maxLength, letters.length)
        ); 
    
        // Remove duplicates
        foundWords = [...new Set(foundWords)];
       
        // Calculate points and prepare response
        let wordsWithDetails = foundWords.map(word => ({
            word,
            points: calculatePoints(word),
            length: word.length,
            definition: null
        }));

        if( includeDefinitions && wordsWithDetails.length > 0 ){
            const topWords = wordsWithDetails.sort( (a, b) => {
                return b.points - a.points
            } ).slice(0, 20)

            for (let wordObj of topWords) {
                const defQuery = `What is the definition of the Scrabble word "${wordObj.word}"? Provide a brief, clear definition in under 30 words.`;
                const defResult = await ragChain.invoke(defQuery);
                wordObj.definition = defResult.trim();
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Merge back with remaining words
            const remainingWords = wordsWithDetails.slice(20);
            wordsWithDetails = [...topWords, ...remainingWords];
            wordsWithDetails = wordsWithDetails.filter( (w) => w.definition )
        }

        // Sort by points (highest first), then by length
        wordsWithDetails = wordsWithDetails.sort((a, b) => b.points - a.points || b.length - a.length);
        
 
        const stats = {
        totalWords: wordsWithDetails.length,
        maxPoints: wordsWithDetails.length > 0 ? wordsWithDetails[0].points : 0,
        minPoints: wordsWithDetails.length > 0 ? wordsWithDetails[wordsWithDetails.length - 1].points : 0,
        averageLength: wordsWithDetails.length > 0 ? 
            Math.round(wordsWithDetails.reduce((sum, w) => sum + w.length, 0) / wordsWithDetails.length * 10) / 10 : 0,
        averagePoints: wordsWithDetails.length > 0 ?
            Math.round(wordsWithDetails.reduce((sum, w) => sum + w.points, 0) / wordsWithDetails.length * 10) / 10 : 0,
        lengthDistribution: {}
        };


        // Calculate length distribution
        wordsWithDetails.forEach(word => {
            stats.lengthDistribution[word.length] = (stats.lengthDistribution[word.length] || 0) + 1;
        });

        res.json({
            letters: letters.toUpperCase(),
            words: wordsWithDetails,
            stats,
            searchCriteria: {
                minLength,
                maxLength: Math.min(maxLength, letters.length),
                includeDefinitions
            }
        });

    } catch (error) {
        console.error('Error finding words:', error);  
        if (error.code === 'insufficient_quota') {
        return res.status(429).json({ error: 'OpenAI API quota exceeded' });
        }
        
        if (error.code === 'rate_limit_exceeded') {
        return res.status(429).json({ error: 'Rate limit exceeded, please try again later' });
        }
        
        res.status(500).json({ error: 'Internal server error' });
    }

}



module.exports = { findScrabbleWords }