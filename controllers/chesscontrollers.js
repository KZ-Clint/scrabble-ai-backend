const OpenAI = require('openai');
const axios = require('axios')

// OpenAI Configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


const findChessMove = async (req, res) => {
    const { imgUrl } = req.body

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

    const response =  openai.images.edit({
        model:"gpt-image-1",
        image:imgUrl,
        n:1,
        output_format:"jpeg",       
    })

    console.log(response)
}


module.exports = { findChessMove }