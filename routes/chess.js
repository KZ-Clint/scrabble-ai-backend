const express = require('express')
const { findChessMove } = require('../controllers/chesscontrollers')


const router = express.Router()



router.patch( '/find-move', findChessMove )


module.exports = router