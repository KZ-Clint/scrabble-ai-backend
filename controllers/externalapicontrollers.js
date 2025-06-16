const OpenAI = require('openai');
const axios = require('axios')

// OpenAI Configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Scrabble letter points
const LETTER_POINTS = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10
};

// Calculate word points
const calculatePoints = (word) => {
    return word.split('').reduce( (total, letter) => {
        return total + (LETTER_POINTS[letter.toUpperCase()] || 0)
    },0)
}

// Check if a word can be formed from given letters
const canFormWord = (word, availableLetters) => {
    let letterCount = {}
     
    //count available letters
    for ( const letter of availableLetters.toUpperCase() ) {
        letterCount[letter] = (letterCount[letter] || 0) + 1
    }

    //check if word can be formed
    for ( const letter of word.toUpperCase() ){
        if( !letterCount[letter] || letterCount[letter] == 0 ){
            return false
        }
        letterCount[letter]--

    }
    
    return true
}

// Validate word using AI
const validateWordWithAI = async (word) => {
    try {
       const prompt = `Is "${word}" a valid English word that would be accepted in Scrabble? 
    
                        Respond with only "YES" or "NO" followed by a brief definition if YES.
                        Format: YES - [definition] OR NO
    
                        Word: ${word}`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 100,
            temperature: 0.1,
        });            

        const response = completion.choices[0]?.message?.content || '';
        const isValid = response.toUpperCase().startsWith('YES');
        const definition = isValid ? response.substring(response.indexOf('-') + 1).trim() : null;
        
        return { isValid, definition };

    } catch (error) {
        console.error('Error validating word with AI:', error);
        return { isValid: false, definition: null };
    }
}


// Get word definition using AI
const getWordDefinition = async (word) => {
    try {
        const prompt = `Provide a brief, clear definition for the word "${word}" as it would be used in Scrabble. 
    
                        Keep it concise (under 50 words). If it's not a valid English word, respond with "INVALID".
                        
                        Word: ${word}`;
        
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 80,
            temperature: 0.1,
        });

        const definition = completion.choices[0]?.message?.content || '';
        return definition === 'INVALID' ? null : definition;

    } catch (error) {
        console.error('Error getting definition:', error);
        return null;
    }
}



const findScrabbleWords = async (req,res) => {

    try {      
        const { letters, minLength = 2, maxLength = 15, includeDefinitions = true } = req.body;
    
        if (!letters || typeof letters !== 'string') {
           return res.status(400).json({ error: 'Letters parameter is required and must be a string' });
        }
        
        if (letters.length > 15) {
           return res.status(400).json({ error: 'Maximum 15 letters allowed' });
        }

        if (letters.length < minLength) {
           return res.status(400).json({ error: 'Not enough letters provided' });
        }

        // Create comprehensive prompt for AI
        const prompt = `Given the letters "${letters.toUpperCase()}", find ALL valid words that can be formed using these letters. Each letter can only be used once per word.
        
        STRICT RULES:
        - Minimum word length: ${minLength} letters
        - Maximum word length: ${Math.min(maxLength, letters.length)} letters  
        - Only standard English dictionary words accepted in Scrabble
        - Each letter from "${letters.toUpperCase()}" can only be used once per word
        - Make sure you're using a comprehensive Scrabble word list, such as: SOWPODS (International), CSW21 or TWL (updated Scrabble tournament dictionaries)
        - Include plurals, verb forms
        - Include common words, proper nouns are NOT allowed
        
        Available letters: ${letters.toUpperCase()}
        Letter count: ${letters.toUpperCase().split('').reduce((acc, letter) => {
        acc[letter] = (acc[letter] || 0) + 1;
        return acc;
        }, {})}
        
        Provide ONLY VALID words, one per line, no explanations, no numbering, no additional text.
        Try to find at least 5-15 words if possible.`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1000,
            temperature: 0.3,
        });

        const aiResponse = completion.choices[0]?.message?.content || '';

        // Process AI response
        let foundWords = aiResponse
        .split('\n')
        .map(word => word.trim().toUpperCase())
        .filter(word => {
            // Filter out empty lines, non-alphabetic characters, and validate constraints
            return word.length >= minLength && 
                word.length <= Math.min(maxLength, letters.length) &&
                /^[A-Z]+$/.test(word) &&
                canFormWord(word, letters);
        });

        // Remove duplicates
        foundWords = [...new Set(foundWords)];

        // Calculate points and prepare response
        let wordsWithDetails = foundWords.map(word => ({
            word,
            points: calculatePoints(word),
            length: word.length,
            definition: null
        }));

        if( includeDefinitions && wordsWithDetails.length > 0 ){
            const topWords = wordsWithDetails.sort( (a, b) => {
                return b.points - a.points
            } ).slice(0, 20)

            for (let wordObj of topWords) {
                const definition = await getWordDefinition(wordObj.word);
                wordObj.definition = definition;
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Merge back with remaining words
            const remainingWords = wordsWithDetails.slice(20);
            wordsWithDetails = [...topWords, ...remainingWords];
            wordsWithDetails = wordsWithDetails.filter( (w) => w.definition )
        }

        // Sort by points (highest first), then by length
        wordsWithDetails = wordsWithDetails.sort((a, b) => b.points - a.points || b.length - a.length);
 
        const stats = {
        totalWords: wordsWithDetails.length,
        maxPoints: wordsWithDetails.length > 0 ? wordsWithDetails[0].points : 0,
        minPoints: wordsWithDetails.length > 0 ? wordsWithDetails[wordsWithDetails.length - 1].points : 0,
        averageLength: wordsWithDetails.length > 0 ? 
            Math.round(wordsWithDetails.reduce((sum, w) => sum + w.length, 0) / wordsWithDetails.length * 10) / 10 : 0,
        averagePoints: wordsWithDetails.length > 0 ?
            Math.round(wordsWithDetails.reduce((sum, w) => sum + w.points, 0) / wordsWithDetails.length * 10) / 10 : 0,
        lengthDistribution: {}
        };


        // Calculate length distribution
        wordsWithDetails.forEach(word => {
            stats.lengthDistribution[word.length] = (stats.lengthDistribution[word.length] || 0) + 1;
        });

        res.json({
            letters: letters.toUpperCase(),
            words: wordsWithDetails,
            stats,
            searchCriteria: {
                minLength,
                maxLength: Math.min(maxLength, letters.length),
                includeDefinitions
            }
        });

    } catch (error) {
        console.error('Error finding words:', error);  
        if (error.code === 'insufficient_quota') {
        return res.status(429).json({ error: 'OpenAI API quota exceeded' });
        }
        
        if (error.code === 'rate_limit_exceeded') {
        return res.status(429).json({ error: 'Rate limit exceeded, please try again later' });
        }
        
        res.status(500).json({ error: 'Internal server error' });
    }

}



module.exports = { findScrabbleWords }