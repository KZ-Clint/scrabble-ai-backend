const express = require('express')
const { findChessMove } = require('../controllers/chesscontrollers')


const router = express.Router()



router.post( '/find-move', findChessMove )


module.exports = router