from flask import Flask, render_template, request, jsonify
import speech_recognition as sr
import numpy as np
import sounddevice as sd
import wave
import os
from scipy.io import wavfile
import difflib
import nltk
from nltk.corpus import cmudict

app = Flask(__name__)

# Download required NLTK data
try:
    nltk.data.find('corpora/cmudict')
except LookupError:
    nltk.download('cmudict')

# Initialize the speech recognizer and pronunciation dictionary
recognizer = sr.Recognizer()
try:
    pronouncing_dict = cmudict.dict()
except:
    nltk.download('cmudict')
    pronouncing_dict = cmudict.dict()

# Categories of practice words
PRACTICE_WORDS = {
    'basic': [
        'cat', 'dog', 'book', 'sun', 'moon', 'star', 'tree', 'fish',
        'bird', 'hand', 'foot', 'eye', 'nose', 'mouth', 'ear', 'ball',
        'car', 'house', 'door', 'chair'
    ],
    'intermediate': [
        'apple', 'orange', 'banana', 'purple', 'yellow', 'window',
        'pencil', 'paper', 'water', 'table', 'sister', 'brother',
        'garden', 'flower', 'rabbit', 'turtle', 'monkey', 'tiger'
    ],
    'advanced': [
        'elephant', 'butterfly', 'beautiful', 'computer', 'umbrella',
        'chocolate', 'strawberry', 'basketball', 'wonderful', 'family',
        'telephone', 'alligator', 'octopus', 'dinosaur', 'unicorn'
    ]
}

def get_phonemes(word):
    """Get the phonemes for a word using CMU dictionary."""
    word = word.lower()
    if word in pronouncing_dict:
        return pronouncing_dict[word][0]
    return None

def analyze_pronunciation(expected_word, recognized_word):
    """Analyze pronunciation at the syllable level."""
    expected_word = expected_word.lower()
    recognized_word = recognized_word.lower()
    
    # Get syllable information for both words
    expected_info = get_syllable_info(expected_word)
    recognized_info = get_syllable_info(recognized_word)
    
    if not expected_info['syllables']:
        return None, "Word not found in pronunciation dictionary"
    
    # Initialize analysis results
    analysis = []
    total_score = 0
    syllable_scores = []
    
    # Compare syllables
    expected_syllables = expected_info['syllables']
    recognized_syllables = recognized_info['syllables']
    
    # Calculate score for each syllable
    for i, expected_syl in enumerate(expected_syllables):
        syllable_result = {
            'syllable': ''.join(expected_syl),
            'expected_phonemes': expected_syl,
            'correct': False,
            'score': 0
        }
        
        if i < len(recognized_syllables):
            recognized_syl = recognized_syllables[i]
            # Compare phonemes in the syllable
            correct_phonemes = sum(1 for ep, rp in zip(expected_syl, recognized_syl) if ep == rp)
            total_phonemes = max(len(expected_syl), len(recognized_syl))
            syllable_score = correct_phonemes / total_phonemes if total_phonemes > 0 else 0
            
            syllable_result['correct'] = syllable_score > 0.8
            syllable_result['score'] = syllable_score
            syllable_result['recognized_phonemes'] = recognized_syl
        else:
            syllable_result['recognized_phonemes'] = []
            syllable_result['score'] = 0
            
        analysis.append(syllable_result)
        syllable_scores.append(syllable_result['score'])
    
    # Calculate overall score as average of syllable scores
    total_score = sum(syllable_scores) / len(syllable_scores) if syllable_scores else 0
    
    return analysis, "Syllable-based analysis", total_score

def get_practice_word(difficulty=None):
    """Get a random practice word based on difficulty."""
    if not difficulty or difficulty not in PRACTICE_WORDS:
        difficulty = 'basic'
    
    words = PRACTICE_WORDS[difficulty]
    return np.random.choice(words)

def generate_feedback(score, analysis, expected_word, recognized_word):
    """Generate detailed feedback based on syllable-level pronunciation analysis."""
    feedback = []
    
    # Add word comparison
    if expected_word.lower() == recognized_word.lower():
        feedback.append("Excellent! You pronounced the word correctly.")
    else:
        feedback.append(f"You said '{recognized_word}' instead of '{expected_word}'.")
    
    # Add syllable-specific feedback
    if analysis:
        incorrect_syllables = []
        for i, syllable_data in enumerate(analysis):
            syllable = syllable_data['syllable']
            syllable_score = syllable_data['score']
            
            if syllable_score < 0.8:  # If syllable score is less than 80%
                incorrect_syllables.append({
                    'syllable': syllable,
                    'position': i + 1,
                    'score': syllable_score
                })
        
        if incorrect_syllables:
            feedback.append("\nSyllables that need improvement:")
            for syl_data in incorrect_syllables:
                position_text = "first" if syl_data['position'] == 1 else (
                    "second" if syl_data['position'] == 2 else (
                    "third" if syl_data['position'] == 3 else f"{syl_data['position']}th"
                ))
                score_percentage = int(syl_data['score'] * 100)
                score_class = 'score-high' if score_percentage >= 80 else (
                    'score-medium' if score_percentage >= 60 else 'score-low'
                )
                feedback.append(f"- The {position_text} syllable '{syl_data['syllable']}' needs work (<span class='{score_class}'>Score: {score_percentage}%</span>)")
    
    # Add overall score feedback with color
    overall_score_percentage = int(score * 100)
    overall_score_class = 'score-high' if overall_score_percentage >= 80 else (
        'score-medium' if overall_score_percentage >= 60 else 'score-low'
    )
    
    if score >= 0.9:
        feedback.append(f"\nOverall: <span class='{overall_score_class}'>Excellent pronunciation!</span>")
    elif score >= 0.7:
        feedback.append(f"\nOverall: <span class='{overall_score_class}'>Good pronunciation, but there's room for improvement.</span>")
    elif score >= 0.5:
        feedback.append(f"\nOverall: <span class='{overall_score_class}'>Your pronunciation needs some work.</span>")
    else:
        feedback.append(f"\nOverall: <span class='{overall_score_class}'>Let's focus on improving your pronunciation.</span>")
    
    # Add tips for improvement
    if score < 0.9:
        feedback.append("\nTips for improvement:")
        feedback.append("- Listen carefully to the correct pronunciation")
        feedback.append("- Break down the word into syllables and practice each part")
        feedback.append("- Pay attention to the length of each syllable")
        feedback.append("- Watch your mouth shape in a mirror while practicing")
        feedback.append("- Feel the vibrations in your throat and chest")
    
    return "\n".join(feedback)

def get_syllable_info(word):
    """Get syllable information including stress and timing."""
    word = word.lower()
    if word in pronouncing_dict:
        phonemes = pronouncing_dict[word][0]
        syllables = []
        current_syllable = []
        timing_guide = []
        
        for phoneme in phonemes:
            # Check if it's a stress marker
            if any(c.isdigit() for c in phoneme):
                stress_level = next(c for c in phoneme if c.isdigit())
                # Add timing information based on stress
                if stress_level == '1':
                    timing_guide.append('long')  # Primary stress - longer duration
                elif stress_level == '2':
                    timing_guide.append('medium')  # Secondary stress - medium duration
                else:
                    timing_guide.append('short')  # No stress - shorter duration
                
                # Add the syllable without the stress number
                current_syllable.append(''.join(c for c in phoneme if not c.isdigit()))
                syllables.append(current_syllable)
                current_syllable = []
            else:
                current_syllable.append(phoneme)
        
        # Add any remaining phonemes as a syllable
        if current_syllable:
            syllables.append(current_syllable)
            timing_guide.append('short')
        
        # If no syllables were found, treat the whole word as one syllable
        if not syllables:
            return {
                'syllables': [[word]],
                'timing': ['medium'],
                'phonemes': phonemes
            }
        
        return {
            'syllables': syllables,
            'timing': timing_guide,
            'phonemes': phonemes
        }
    
    # Fallback for words not in the dictionary
    return {
        'syllables': [[word]],
        'timing': ['medium'],
        'phonemes': [word.upper()]
    }

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/get_word', methods=['GET'])
def get_word():
    difficulty = request.args.get('difficulty', None)
    word = get_practice_word(difficulty)
    syllable_info = get_syllable_info(word)
    
    return jsonify({
        'word': word,
        'syllables': syllable_info['syllables'],
        'timing': syllable_info['timing'],
        'pronunciation_guide': ' - '.join(syllable_info['phonemes']),
        'display_text': word
    })

@app.route('/analyze_speech', methods=['POST'])
def analyze_speech():
    if 'audio' not in request.files:
        return jsonify({
            'success': False,
            'error': 'No audio file provided',
            'feedback': 'No audio was received. Please try recording again.',
            'text': '',
            'confidence': 0,
            'syllable_scores': []
        }), 400
    
    file = request.files['audio']
    expected_word = request.form.get('expected_text', '').strip()
    expected_word = expected_word.split('\n')[0].strip().lower()
    
    temp_path = 'temp_audio.wav'
    try:
        file.save(temp_path)
        
        with sr.AudioFile(temp_path) as source:
            # Adjust recognizer for maximum sensitivity
            recognizer.energy_threshold = 100  # Much lower threshold for better sensitivity
            recognizer.dynamic_energy_threshold = True
            recognizer.dynamic_energy_adjustment_damping = 0.15
            recognizer.dynamic_energy_ratio = 1.5
            recognizer.pause_threshold = 0.3  # Shorter pause threshold
            recognizer.operation_timeout = None  # No timeout
            recognizer.phrase_threshold = 0.1  # More sensitive phrase detection
            recognizer.non_speaking_duration = 0.1  # Shorter non-speaking duration
            
            # Record with ambient noise adjustment
            recognizer.adjust_for_ambient_noise(source, duration=0.1)
            audio = recognizer.record(source)
            
            try:
                # Try with increased sensitivity and all possible results
                recognized_text = recognizer.recognize_google(audio, 
                    language='en-US',
                    show_all=True
                )
                
                if not recognized_text:
                    raise sr.UnknownValueError()
                
                # Process all possible transcriptions
                if isinstance(recognized_text, dict) and 'alternative' in recognized_text:
                    alternatives = recognized_text['alternative']
                    found_match = False
                    
                    # First, try to find an exact match
                    for alt in alternatives:
                        transcript = alt['transcript'].lower().strip()
                        # Check if the transcript contains our expected word
                        if expected_word in transcript.split() or transcript in expected_word or expected_word in transcript:
                            recognized_text = expected_word  # Use the expected word if it's found
                            found_match = True
                            break
                    
                    # If no match found, use the closest matching alternative
                    if not found_match:
                        # Get the first result
                        recognized_text = alternatives[0]['transcript']
                else:
                    # Handle single result case
                    recognized_text = str(recognized_text)
                
                # Clean up the recognized text
                recognized_text = recognized_text.lower().strip()
                
                # Log for debugging
                print(f"Expected word: {expected_word}")
                print(f"Raw recognized text: {recognized_text}")
                
            except sr.UnknownValueError:
                return jsonify({
                    'success': False,
                    'error': 'Could not understand audio',
                    'text': '',
                    'confidence': 0,
                    'feedback': (
                        "I couldn't understand what you said. Here are some tips:\n\n"
                        "1. Speak clearly and at a normal pace\n"
                        "2. Make sure there's not too much background noise\n"
                        "3. Hold the microphone closer to your mouth\n"
                        "4. Try speaking a bit louder\n\n"
                        f"The word to pronounce is: {expected_word.upper()}"
                    ),
                    'syllable_scores': []
                }), 200
                
            except sr.RequestError as e:
                return jsonify({
                    'success': False,
                    'error': 'Speech recognition service error',
                    'text': '',
                    'confidence': 0,
                    'feedback': (
                        "There was a problem with the speech recognition service.\n\n"
                        "Please check your internet connection and try again.\n"
                        "If the problem persists, wait a few moments before trying."
                    ),
                    'syllable_scores': []
                }), 200
        
        # Extract the first word if multiple words were recognized
        recognized_word = recognized_text.split()[0].lower()
        
        # Analyze pronunciation
        analysis, analysis_type, score = analyze_pronunciation(expected_word, recognized_word)
        
        # Extract syllable scores
        syllable_scores = [item['score'] for item in analysis] if analysis else []
        
        # Generate feedback
        feedback = generate_feedback(score, analysis, expected_word, recognized_word)
        
        # Get syllable information
        syllable_info = get_syllable_info(expected_word)
        
        response_data = {
            'success': True,
            'text': recognized_word,
            'confidence': score,
            'feedback': feedback,
            'analysis': analysis,
            'expected_word': expected_word,
            'syllable_info': syllable_info,
            'syllable_scores': syllable_scores,
            'pronunciation_guide': ' - '.join(get_phonemes(expected_word) or [])
        }
        return jsonify(response_data)
        
    except Exception as e:
        print(f"Error in analyze_speech: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e),
            'text': '',
            'confidence': 0,
            'feedback': (
                "An error occurred while processing your speech.\n\n"
                "1. Check if your microphone is properly connected\n"
                "2. Make sure you have a stable internet connection\n"
                "3. Try refreshing the page if the problem persists\n\n"
                f"The word to pronounce is: {expected_word.upper()}"
            ),
            'syllable_scores': []
        }), 200
    
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                print(f"Error cleaning up temporary file: {e}")

if __name__ == '__main__':
    app.run(debug=True) 