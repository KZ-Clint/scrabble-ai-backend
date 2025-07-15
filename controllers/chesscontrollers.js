const OpenAI = require('openai');
const axios = require('axios')
const fs = require("fs")
const { toFile } = require('openai');
const path = require('path');

// OpenAI Configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


const findChessMove = async (req, res) => {
    const { imgUrl } = req.body

    const extractImg = async (url) => {
        let newPathName = null;
        let newMimeType = null;

        // extract filename from URL
        const getFileNameFromUrl = (url) => {
          const pathname = new URL(url).pathname;
          newPathName = path.basename(pathname); // e.g. 'image.webp'
        };

        getFileNameFromUrl(url)

        // extract mime type from file extension
        const getMimeTypeFromExtension = (newPathName) => {
          const ext = path.extname(newPathName).toLowerCase();
          switch (ext) {
            case '.jpg':
            case '.jpeg':
              newMimeType = 'image/jpeg';
              break;
            case '.png':
              newMimeType = 'image/png';
              break;
            case '.webp':
              newMimeType = 'image/webp';
              break;
            default:
              return 'application/octet-stream'; // fallback
          }
        };

        getMimeTypeFromExtension(newPathName)

        // 1. Download the image as a buffer
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
        });
        const buffer = Buffer.from(response.data); 



        return { newPathName, newMimeType, buffer }
    
    }

    // Extract images pathname mimetype and buffer 
    const imageFiles = await Promise.all(
        [imgUrl].map( (url) => extractImg(url) )
    )

    console.log(imageFiles)

    // Convert buffer to file object for OpenAI
    const imageToFiles = await Promise.all(
      imageFiles.map( async (img) =>
         await toFile(img.buffer, img.newPathName, { type: img.newMimeType }) 
      )
    )

    console.log(imageToFiles)

    const prompt = `You are a professional chess player. Analyzing the chess image provided, generate an image edit which
    would show the best possible move to make by both opponent(black and white).
    if you are showing the best move for black, show the moves in the square box with a red border.
    If you are showing the best move for white, show the moves in the square box with a green border
    E.g if you are showing for white, and you decide the best move is to play the pawn a step forward, 
    then the path the pawn took along the square boxes should have a green border.
    If you are showing for black, and you decide the best move is to play the pawn a step forward, 
    then the path the pawn took along the square boxes should have a red border.
    The generated image should clearly show the best move for both players.
    
    NOTE: If the image does not contain a chess board or chess pieces, respond with the text "INVALID" .
    `
    try {
      const response = await openai.images.edit({
          model:"gpt-image-1",
          image:imageToFiles,
          n:1,
          output_format:"jpeg",   
          prompt    
      })

      console.log(response)

      res.json({ response });


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


module.exports = { findChessMove }