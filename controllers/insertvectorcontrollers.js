const OpenAI = require('openai');
const axios = require('axios');
const { Pinecone } = require('@pinecone-database/pinecone');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { loadQAStuffChain } = require('langchain/chains')
const { Document } = require('langchain/document')
const LangChainOpenAI = require('@langchain/openai').OpenAI
const { TextLoader } = require('langchain/document_loaders/fs/text');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');

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




const insertVectorInPineWave = async (req,res) => {
    const { indexName, document } = req.body

    const index = pc.index(indexName)

    try {

        const loader = new TextLoader(document);
        const rawDocs = await loader.load();

        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000, // Increase chunk size since sentences vary in length
            chunkOverlap: 0,
            separators: [
                '\r\n\r\n',  // Windows double newline (paragraph breaks)
                '\n\n',      // Unix double newline (paragraph breaks)
                '\r\n',      // Windows single newline
                '. ',        // Sentence endings
                '! ',        // Exclamation endings
            ],
        });

        const splitDocs = await splitter.splitDocuments(rawDocs);

        const arrayOfDocChunks = splitDocs.map(doc => doc.pageContent)

        const scheduleEmbeddings = await embeddings.embedDocuments(arrayOfDocChunks)

        console.log( "length of embeddings", scheduleEmbeddings.length, scheduleEmbeddings )

        const scheduleVectors = scheduleEmbeddings.map( (embedding, i) => ({
            id: `chunk_${i}`,
            values:embedding,
            metadata: {
                text:arrayOfDocChunks[i]
            }
        }) )

       const insertedVectors = await index.upsert(scheduleVectors)
        
        res.status(200).json({ insertedVectors, splitDocs, scheduleEmbeddings });

            
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




module.exports = { insertVectorInPineWave }