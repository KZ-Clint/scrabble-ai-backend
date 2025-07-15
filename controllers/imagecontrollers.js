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



const getTodo = async (req,res) => {
    const { query } = req.body
    const indexName = "opennote";
    const index = pc.index(indexName)

    try {

        const queryEmbedding = await embeddings.embedQuery(query)

        let queryResponse = await index.query({
            vector:queryEmbedding,
            topK:5,
            includeMetadata:true
        })

        const concatenatedText = queryResponse.matches.map( (data) => data.metadata.text ).join(" ")
        console.log("concatenated text", concatenatedText )

        const llm = new LangchainOpenAI({
           openAIApiKey: process.env.OPENAI_API_KEY,
           maxTokens: 1000,
           temperature: 0.1
        })

        const customPrompt = PromptTemplate.fromTemplate(`
            Use the following context to answer the question. Provide a complete and detailed answer.

            Context: ${concatenatedText}

            Question: ${query}

            Answer:`);

        const chain = loadQAStuffChain(llm, { prompt: customPrompt })

        const result = await chain.invoke({
            input_documents: [ new Document({ pageContent: concatenatedText })],
            question: query,
        })
        
        res.status(200).json({ result });
            
    } catch (error) {
        console.error('Error finding moves:', error);  
        if (error.code === 'insufficient_quota') {
        return res.status(429).json({ error: 'OpenAI API quota exceeded' });
        }
        
        if (error.code === 'rate_limit_exceeded') {
        return res.status(429).json({ error: 'Rate limit exceeded, please try again later' });
        }
        
        res.status(500).json({ error: 'Internal server error' });
    }

}



const gradeTodo = async (req,res) => {
    const { submittedAnswer, originalQuestion } = req.body
    const indexName = "opennote";
    const index = pc.index(indexName)

    try {

        const questionEmbedding = await embeddings.embedQuery(originalQuestion)

        let queryResponse = await index.query({
            vector:questionEmbedding,
            topK:3,
            includeMetadata:true
        })

        console.log("All retrieved matches:", queryResponse.matches.map(m => ({
            score: m.score,
            text: m.metadata.text
        })));

        const concatenatedText = queryResponse.matches.map( (data) => data.metadata.text ).join(" ")
        console.log("concatenated text", concatenatedText )

        const llm = new LangchainOpenAI({
           openAIApiKey: process.env.OPENAI_API_KEY,
           maxTokens: 1000,
           temperature: 0.1
        })

        const gradingPrompt = PromptTemplate.fromTemplate(`
            You are a grading assistant. Grade the submitted answer on a scale of 0 to 100 
            based on the provided answer key/context.

            Answer Key/Context: {context}
            Submitted Answer: {submitted_answer}
            Question/Topic: {original_question}

            Instructions:
            - Return a valid JSON object with exactly these two keys: "feedback" and "score".
            - "feedback" should be a helpful explanation of what was good or missing.
            - "score" should be a number between 0 and 100.

            Output format (in JSON):
            {{
                "feedback": "Your feedback here.",
                "score": 85
            }}
        `);

        const gradingChain = gradingPrompt.pipe(llm)

        const result = await gradingChain.invoke({
            context:concatenatedText,
            submitted_answer: submittedAnswer,
            original_question: originalQuestion
        })
        
        const parsed = JSON.parse(result.trim());
        console.log(parsed)

        res.status(200).json({ result });
            
    } catch (error) {
        console.error('Error grading:', error);  
        if (error.code === 'insufficient_quota') {
        return res.status(429).json({ error: 'OpenAI API quota exceeded' });
        }
        
        if (error.code === 'rate_limit_exceeded') {
        return res.status(429).json({ error: 'Rate limit exceeded, please try again later' });
        }
        
        res.status(500).json({ error: 'Internal server error' });
    }

}




// Method 2: More robust approach with validation
const cleanMarkdownStringRobust = (str) => {
    // Trim whitespace
    str = str.trim();
    
    // Check if it starts with markdown code block
    if (str.startsWith('```')) {
        // Find the first newline after the opening ```
        const firstNewline = str.indexOf('\n');
        if (firstNewline !== -1) {
            str = str.substring(firstNewline + 1);
        }
    }
    
    // Check if it ends with closing ```
    if (str.endsWith('```')) {
        // Find the last newline before the closing ```
        const lastNewline = str.lastIndexOf('\n```');
        if (lastNewline !== -1) {
            str = str.substring(0, lastNewline);
        } else {
            // If no newline before ```, just remove the ```
            str = str.substring(0, str.length - 3);
        }
    }
    
    const newStr = str.replace(/\n/g, '')
    return newStr.replace(/\\"/g, '"');    

}


const analyzeImage = async (imgUrl) => {

    const prompt = `
        Extract all visible texts from the image, preserving their layout and structural hierarchy.

        - If the image contains diagrams, describe each diagram and include the description in parentheses. Place it close to the relevant text or in the position it appears within the layout, while maintaining the visual structure and spacing.

        - Format your response using valid HTML structure that reflects the original visual formatting of the text.

        Example:
        If the image contains:
        - A header that says: "Hello Everyone"
        - A paragraph that says: "We are here today"
        - Followed by bullet points: "Yes" and "Hurray"

        Your output should be:

        <div>
        <h1>Hello Everyone</h1>
        <p>We are here today</p>
        <ul>
            <li>Yes</li>
            <li>Hurray</li>
        </ul>
        </div>
     
    `;

    try {
        const response = await openai.chat.completions.create({
            model:"gpt-4.1",
            messages:[
                    {
                        role:"user",
                        content:[
                            { type:"text", text:prompt },
                            { 
                                type:"image_url",
                                image_url:{ url:imgUrl }
                            }
                        ]
                    }
            ] 
        })

        let cleaned = cleanMarkdownStringRobust(response.choices[0]?.message?.content || "" )
        return { response, cleaned }

    } catch (error) {
        console.error('Error analyzing image:', error);  
        if (error.code === 'insufficient_quota') {
        return { error: 'OpenAI API quota exceeded' };
        }
        
        if (error.code === 'rate_limit_exceeded') {
        return { error: 'Rate limit exceeded, please try again later' };
        }
        
        return { error: 'Internal server error' };
    }

}



const gradeScript = async (req, res) => {
    const { imgUrl } = req.body

    try {
     const userAnswer = await analyzeImage(imgUrl)



    } catch (error) {
        console.error('Error finding moves:', error);  
        if (error.code === 'insufficient_quota') {
        return res.status(429).json({ error: 'OpenAI API quota exceeded' });
        }
        
        if (error.code === 'rate_limit_exceeded') {
        return res.status(429).json({ error: 'Rate limit exceeded, please try again later' });
        }
        
        res.status(500).json({ error: 'Internal server error' });
    }
   
}




module.exports = { gradeScript, getTodo, gradeTodo }