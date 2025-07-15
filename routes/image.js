const express = require('express')
const { gradeScript, getTodo, gradeTodo } = require('../controllers/imagecontrollers')


const router = express.Router()


router.post( '/grade-script', gradeScript )

router.post( '/get-todo', getTodo )

router.post( '/grade-todo', gradeTodo )


module.exports = router