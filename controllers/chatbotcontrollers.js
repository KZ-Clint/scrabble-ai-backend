const OpenAI = require('openai');
const axios = require('axios');
const { Pinecone } = require('@pinecone-database/pinecone');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { loadQAStuffChain } = require('langchain/chains')
const { Document } = require('langchain/document')
const LangchainOpenAI = require('@langchain/openai').OpenAI
const { PromptTemplate } = require("@langchain/core/prompts");

// OpenAI Configuration
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});


const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY
});

const embeddings = new OpenAIEmbeddings({ 
    openAIApiKey: process.env.OPENAI_API_KEY,
    batchSize:100,
    modelName: "text-embedding-3-small"
});


// Check which language the sentence is in and return the translation
const checkSentenceLanguage = async (sentence) => {
    try {
       const prompt = `what language is this sentence in - "${sentence}" and what would be the translation to english if it is not in English?    
       
        Instructions:
        - If the sentence is in English then no need to translate just modify the original sentence to be error free and fluent
        - If there are more words with another language then let the language be the language with more words
        - If you can not identify the language the sentence is in, just put the language as english
        - Return a valid JSON object with exactly these two keys: "language" and "sentence"
        - language would be a string that contains the language with more words in the sentence e.g english, french, spanish e.t.c
        - sentence would be a string that contains the translated text in english, the sentence must be translated to english, if it is in english modify the original sentence to be error free and fluent
        - Output format should be in JSON exactly like this always:
            {
                "language": "french",
                "sentence": "Hello brother"
            }

        Sentence: ${sentence}`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 800,
            temperature: 0.1,
        });            

        const response = completion.choices[0]?.message?.content || '';
        const parsedResponse = JSON.parse(response.trim())
 
        
        return parsedResponse ;

    } catch (error) {
        console.error('Error checking and translating sentence with AI:', error);
        return error;
    }
}


// If the question is not within the context, this acts as a fallback
const alternativeAnswer = async (question, language) => {
    try {
       const promptSystem = `You are Dr.UPSC assistant a professional UPSC assistant and a supportive companion. 
        Your role is to guide students through their UPSC preparation journey with accurate, friendly, and motivational responses. 
        You should also act like a buddy—empathetic, encouraging, and approachable.

        - Always respond in the student's preferred language: ${language}
        - If the selected language is Hindi, respond in **Romanized Hindi**
        - Maintain clarity, professionalism, and warmth in your tone.`;

       const promptUser = `${question}`

        const responses = await openai.responses.create({
            model: "gpt-4o-mini",
            input: [ 
                { role: "system", content: promptSystem },
                { role:"user", content:promptUser }
            ],
            max_output_tokens: 1600,
            temperature: 0.1,
        });            
        

        const newResponse = responses.output_text.trim() || '';
         console.log(newResponse)
        
        return newResponse ;

    } catch (error) {
        console.error('Error giving alternative answer AI:', error);
        return error;
    }
}



// Check the language and translate the sentence according to the language
const translateSentence = async (sentence, language) => {
    try {
       const prompt = `Translate this sentence - "${sentence}" in this language - "${language}" ?    
       
        Instructions:
        - Keep the formatting intact whilst translating the necessary texts
        - If the language is hindi, use Romanized Hindi
        `;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1600,
            temperature: 0.1,
        });            

        const response = completion.choices[0]?.message?.content || '';
       
        
        return response ;

    } catch (error) {
        console.error('Error translating sentence in the required language with AI:', error);
        return error;
    }
}


const getQA = async (req,res) => {
    const { query, indexName } = req.body
    const index = pc.index(indexName)
    
    try {

        const newSentenceResponse = await checkSentenceLanguage(query)

        const queryEmbedding = await embeddings.embedQuery(newSentenceResponse.sentence)

        let queryResponse = await index.query({
            vector:queryEmbedding,
            topK:5,
            includeMetadata:true
        })
    
        const concatenatedText = queryResponse.matches.map( (data) => data.metadata.text ).join(" ")
        

        const llm = new LangchainOpenAI({
           openAIApiKey: process.env.OPENAI_API_KEY,
           maxTokens: 1600,
           temperature: 0.1
        })

        const customPrompt = PromptTemplate.fromTemplate(`
           Use the following context to answer the question. Provide a complete, clear, accurate and well-structured response.
           Do not introduce additionals that are off context
            Your answer should:
            - Use bullet points for lists where necessary
            - Use colons (:) to introduce explanations where necessary
            - Be formatted neatly and professionally
            - Break content into sections if helpful

            Context: ${concatenatedText}

            Question: ${newSentenceResponse.sentence}

            - If the question is unrelated to the context (e.g., "How are you?" or "What is the formula for force?"), respond strictly with the text: NONE

            Answer:`);

        const chain = loadQAStuffChain(llm, { prompt: customPrompt })

        const result = await chain.invoke({
            input_documents: [ new Document({ pageContent: concatenatedText })],
            question: newSentenceResponse.sentence,
        })

        let newResult = result.text

        if( result.text.trim() === "NONE" || (!result.text && result.text !== 0) ){
            newResult = await alternativeAnswer( newSentenceResponse.sentence, newSentenceResponse.language )
        }


        if ( result.text.trim() !== "NONE" && newSentenceResponse.language !== "english" ) {
            newResult = await translateSentence( result.text, newSentenceResponse.language )
        }
  
        
        res.status(200).json({  newResult, result, queryResponse });

            
    } catch (error) {
        console.error('Error:', error);  
        if (error.code === 'insufficient_quota') {
        return res.status(429).json({ error: 'OpenAI API quota exceeded' });
        }
        
        if (error.code === 'rate_limit_exceeded') {
        return res.status(429).json({ error: 'Rate limit exceeded, please try again later' });
        }
        
        res.status(500).json({ error: 'Internal server error' });
    }

}



module.exports = { getQA }