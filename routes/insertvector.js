const express = require('express')
const { insertVectorInPineWave } = require('../controllers/insertvectorcontrollers')


const router = express.Router()


router.post( '/insert-vector', insertVectorInPineWave )


module.exports = router