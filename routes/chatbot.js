const express = require('express')
const { getQA } = require('../controllers/chatbotcontrollers')


const router = express.Router()


router.post( '/get-qa', getQA )


module.exports = router