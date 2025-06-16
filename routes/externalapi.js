const express = require('express')
const { findScrabbleWords } = require('../controllers/externalapicontrollers')


const router = express.Router()



router.post( '/find-words', findScrabbleWords )


module.exports = router