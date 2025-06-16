const express = require('express')
const mongoose = require('mongoose')
require('dotenv/config')
const morgan = require('morgan')
const bodyParser = require('body-parser')
const cors = require('cors')
const externalApiRoutes = require('./routes/externalapi')
const chessRoutes = require('./routes/chess')

const app = express()


//MIDDLEWARE
app.use( bodyParser.json() )
app.use( express.json() )
app.use(morgan("common"))

app.use( cors( {
  origin:"*"
}) )

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get( "/get", async (req,res) => { 
    try {
       res.status(200).json("LIVE!!!") 
    } catch (error) {
     
    }     
} )


app.post('/translate', async(req, res) => {
  try {
    const response = await fetch("https://cloud.olakrutrim.com/api/v1/languagelabs/translation", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OLA_API_KEYS}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text:req.body.text,
        src_language: req.body.srcLang,
        tgt_language: req.body.tgtLang,
        model: "krutrim-translate-v1.0",
      }),
    });

    const data = await response.json();
   
    const newData = data.data.translated_text || req.body.text; 
    res.status(200).json({ translated_text:newData }) 
  } catch (error) {
    console.error("Translation API Error:", error);
    res.status(500).json({ error, status:"failed", domain:"local" })
  }

});


app.use( '/api',  externalApiRoutes )

app.use( '/api/chess',  chessRoutes )


mongoose.set("strictQuery", false);
const dburi = process.env.DB_CONNECTION
mongoose.connect(dburi)
console.log('connected to db')


app.listen(process.env.PORT)