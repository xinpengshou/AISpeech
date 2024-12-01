// Practice word difficulty levels
const difficulties = ['basic', 'intermediate', 'advanced'];
let currentDifficulty = 'basic';

// DOM Elements
const recordBtn = document.getElementById('recordBtn');
const recordingStatus = document.getElementById('recordingStatus');
const currentWord = document.getElementById('currentWord');
const newWordBtn = document.getElementById('newWordBtn');
const feedbackText = document.getElementById('feedbackText');
const pronunciationScore = document.getElementById('pronunciationScore');
const detectedText = document.getElementById('detectedText');
const practiceHistory = document.getElementById('practiceHistory');
const audioVisualizer = document.getElementById('audioVisualizer');
const difficultySelect = document.createElement('select');

// Add difficulty selector
difficultySelect.className = 'difficulty-select';
difficulties.forEach(diff => {
    const option = document.createElement('option');
    option.value = diff;
    option.text = diff.charAt(0).toUpperCase() + diff.slice(1);
    difficultySelect.appendChild(option);
});
document.querySelector('.word-display').insertBefore(difficultySelect, newWordBtn);

let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let audioContext;
let analyser;
let visualizerContext = audioVisualizer.getContext('2d');
let isProcessing = false;

// Convert WebM to WAV
async function webmToWav(webmBlob) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await webmBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // Create WAV file
    const numOfChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length * numOfChannels * 2;
    const buffer = new ArrayBuffer(44 + length);
    const view = new DataView(buffer);
    
    // Write WAV header
    const writeString = (view, offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    writeString(view, 0, 'RIFF');                     // RIFF identifier
    view.setUint32(4, 36 + length, true);            // File length
    writeString(view, 8, 'WAVE');                     // WAVE identifier
    writeString(view, 12, 'fmt ');                    // fmt chunk
    view.setUint32(16, 16, true);                    // Length of format chunk
    view.setUint16(20, 1, true);                     // Audio format (1 is PCM)
    view.setUint16(22, numOfChannels, true);         // Number of channels
    view.setUint32(24, audioBuffer.sampleRate, true);// Sample rate
    view.setUint32(28, audioBuffer.sampleRate * 2, true); // Byte rate
    view.setUint16(32, numOfChannels * 2, true);     // Block align
    view.setUint16(34, 16, true);                    // Bits per sample
    writeString(view, 36, 'data');                   // data chunk identifier
    view.setUint32(40, length, true);                // data chunk length

    // Write audio data
    const channelData = [];
    for (let i = 0; i < numOfChannels; i++) {
        channelData[i] = audioBuffer.getChannelData(i);
    }

    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
        for (let channel = 0; channel < numOfChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

// Send audio to server
async function sendAudioToServer(audioBlob) {
    try {
        recordingStatus.textContent = 'Converting audio...';
        const wavBlob = await webmToWav(audioBlob);
        
        recordingStatus.textContent = 'Processing audio...';
        const formData = new FormData();
        formData.append('audio', wavBlob, 'recording.wav');
        formData.append('expected_text', currentWord.dataset.originalWord);

        const response = await fetch('/analyze_speech', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        
        if (data.error) {
            feedbackText.innerHTML = `
                <div class="feedback-error">${data.error}</div>
                <div class="feedback-tips">
                    ${data.feedback}
                </div>
            `;
            pronunciationScore.textContent = '-';
            detectedText.textContent = '-';
            return;
        }
        
        // Update feedback display
        feedbackText.innerHTML = data.feedback || 'No feedback available';
        
        // Update overall score with color
        const overallScore = Math.round(data.confidence * 100);
        pronunciationScore.textContent = `${overallScore}%`;
        pronunciationScore.className = overallScore >= 80 ? 'score-high' : 
                                     overallScore >= 60 ? 'score-medium' : 
                                     'score-low';
        
        // Update syllable scores
        const syllablesElement = document.getElementById('syllables');
        if (syllablesElement && data.syllable_scores) {
            const syllableItems = syllablesElement.querySelectorAll('.syllable-item');
            data.syllable_scores.forEach((score, index) => {
                if (syllableItems[index]) {
                    const scoreElement = document.createElement('div');
                    scoreElement.className = 'syllable-score';
                    const scorePercentage = Math.round(score * 100);
                    scoreElement.textContent = `${scorePercentage}%`;
                    scoreElement.classList.add(
                        scorePercentage >= 80 ? 'score-high' :
                        scorePercentage >= 60 ? 'score-medium' :
                        'score-low'
                    );
                    
                    const existingScore = syllableItems[index].querySelector('.syllable-score');
                    if (existingScore) {
                        existingScore.remove();
                    }
                    
                    syllableItems[index].appendChild(scoreElement);
                }
            });
        }
        
        detectedText.textContent = data.text || '-';
        
        if (data.success) {
            addToHistory(data);
        }
    } catch (error) {
        console.error('Error processing audio:', error);
        handleRecordingError();
    } finally {
        recordingStatus.textContent = 'Click to start recording';
        recordingStatus.style.color = '#666';
    }
}

// Initialize audio recording
async function initializeRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
                sampleRate: 48000,
                sampleSize: 24,
                volume: 1.0
            }
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: 'interactive',
            sampleRate: 48000
        });

        const gainNode = audioContext.createGain();
        gainNode.gain.value = 1.5;

        setupAudioVisualization(stream, gainNode);
        
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 256000
        });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            try {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
                await sendAudioToServer(audioBlob);
            } catch (error) {
                console.error('Error processing audio:', error);
                handleRecordingError();
            } finally {
                audioChunks = [];
            }
        };

        recordBtn.disabled = false;
        recordingStatus.textContent = 'Click to start recording';
        recordingStatus.style.color = '#666';
    } catch (error) {
        console.error('Error initializing recording:', error);
        handleRecordingError();
    }
}

function handleRecordingError() {
    feedbackText.innerHTML = `
        <div class="feedback-error">Error processing audio</div>
        <div class="feedback-tips">
            <div>Please try again with these tips:</div>
            <ul>
                <li>Check your microphone connection</li>
                <li>Make sure you have a stable internet connection</li>
                <li>Try refreshing the page if the problem persists</li>
            </ul>
        </div>
    `;
    recordingStatus.textContent = 'Error: Please try again';
    recordingStatus.style.color = 'red';
    pronunciationScore.textContent = '-';
    detectedText.textContent = '-';
    recordBtn.textContent = 'Start Recording';
    recordBtn.classList.remove('recording');
    isRecording = false;
}

// Set up audio visualization
function setupAudioVisualization(stream, gainNode) {
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    
    // Connect through the gain node for boosted signal
    source.connect(gainNode);
    gainNode.connect(analyser);
    
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
    
    visualize();
}

// Visualize audio
function visualize() {
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const width = audioVisualizer.width;
    const height = audioVisualizer.height;
    const barWidth = width / bufferLength * 2.5;
    let barHeight;
    let x = 0;

    function draw() {
        requestAnimationFrame(draw);
        x = 0;

        analyser.getByteFrequencyData(dataArray);
        visualizerContext.fillStyle = '#f5f5f5';
        visualizerContext.fillRect(0, 0, width, height);

        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 2;
            visualizerContext.fillStyle = `rgb(${barHeight + 100}, 50, 50)`;
            visualizerContext.fillRect(x, height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }

    draw();
}

// Get new practice word from server
async function getNewWord() {
    try {
        const response = await fetch(`/get_word?difficulty=${currentDifficulty}`);
        const data = await response.json();
        
        // Clear the current word container
        currentWord.innerHTML = '';
        
        // Create and add the full word display
        const wordDisplay = document.createElement('div');
        wordDisplay.className = 'full-word';
        wordDisplay.textContent = data.word.toUpperCase();
        currentWord.appendChild(wordDisplay);
        
        // Store the original word and other data
        currentWord.dataset.originalWord = data.word;
        currentWord.dataset.syllables = JSON.stringify(data.syllables);
        currentWord.dataset.timing = JSON.stringify(data.timing);
        currentWord.dataset.pronunciation = data.pronunciation_guide;
        
        // Update syllables section with timing visualization
        const syllablesElement = document.getElementById('syllables');
        if (syllablesElement && data.syllables) {
            syllablesElement.innerHTML = ''; // Clear existing content
            
            // Create container for syllables
            const syllablesContainer = document.createElement('div');
            syllablesContainer.className = 'syllables-container';
            
            // Add each syllable with its timing
            data.syllables.forEach((syllable, index) => {
                const syllableDiv = document.createElement('div');
                syllableDiv.className = 'syllable-item';
                
                // Add syllable text
                const syllableText = document.createElement('div');
                syllableText.className = 'syllable-text';
                syllableText.textContent = syllable;
                syllableDiv.appendChild(syllableText);
                
                // Add timing bar
                const timingBar = document.createElement('div');
                timingBar.className = 'timing-bar';
                const timingIndicator = document.createElement('div');
                timingIndicator.className = `timing-indicator ${data.timing[index] || 'normal'}`;
                timingBar.appendChild(timingIndicator);
                syllableDiv.appendChild(timingBar);
                
                // Add timing label
                const timingLabel = document.createElement('div');
                timingLabel.className = 'timing-label';
                if (data.timing[index] === 'long') {
                    timingLabel.textContent = 'stretch longer';
                } else if (data.timing[index] === 'short') {
                    timingLabel.textContent = 'quick';
                }
                syllableDiv.appendChild(timingLabel);
                
                syllablesContainer.appendChild(syllableDiv);
            });
            
            syllablesElement.appendChild(syllablesContainer);
        }
    } catch (error) {
        console.error('Error getting new word:', error);
    }
}

// Update feedback display
function updateFeedback(data) {
    if (!data) return;
    
    // Format the feedback with proper line breaks for HTML
    const formattedFeedback = data.feedback ? data.feedback.replace(/\n/g, '<br>') : 'No feedback available';
    feedbackText.innerHTML = formattedFeedback;
    
    // Update score with color coding
    const score = Math.round(data.confidence * 100);
    pronunciationScore.textContent = score + '%';
    pronunciationScore.style.color = score >= 90 ? '#4CAF50' : 
                                   score >= 70 ? '#2196F3' : 
                                   score >= 50 ? '#FF9800' : '#f44336';
    
    // Update detected text
    detectedText.textContent = data.text || '-';
    
    // Display phoneme analysis if available
    if (data.analysis && Array.isArray(data.analysis)) {
        const analysisDiv = document.createElement('div');
        analysisDiv.className = 'phoneme-analysis';
        
        // Create visual representation of phonemes
        const phonemeDisplay = document.createElement('div');
        phonemeDisplay.className = 'phoneme-display';
        
        data.analysis.forEach(item => {
            if (item.word) {
                // Word-level analysis
                const wordSpan = document.createElement('span');
                wordSpan.className = `word ${item.correct ? 'correct' : 'incorrect'}`;
                wordSpan.textContent = item.word;
                phonemeDisplay.appendChild(wordSpan);
            } else {
                // Phoneme-level analysis
                const phonemeSpan = document.createElement('span');
                phonemeSpan.className = `phoneme ${item.correct ? 'correct' : 'incorrect'}`;
                phonemeSpan.textContent = item.phoneme || item.char;
                phonemeSpan.title = `Expected: ${item.expected_sound}`;
                phonemeDisplay.appendChild(phonemeSpan);
            }
        });
        
        analysisDiv.appendChild(phonemeDisplay);
        feedbackText.appendChild(analysisDiv);
    }
}

// Add to practice history
function addToHistory(data) {
    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    
    // Get the word from syllables
    const syllables = Array.from(document.querySelectorAll('.syllable'))
        .map(el => el.textContent)
        .join('');
    
    historyItem.innerHTML = `
        <p><strong>Word:</strong> ${syllables}</p>
        <p><strong>Score:</strong> <span style="color: ${
            data.confidence >= 0.9 ? '#4CAF50' : 
            data.confidence >= 0.7 ? '#2196F3' : 
            data.confidence >= 0.5 ? '#FF9800' : '#f44336'
        }">${Math.round(data.confidence * 100)}%</span></p>
        <p><strong>Pronounced:</strong> ${data.text}</p>
        <p><strong>Feedback:</strong> ${data.feedback.split('\n')[0]}</p>
    `;
    
    practiceHistory.insertBefore(historyItem, practiceHistory.firstChild);
    
    // Limit history items
    if (practiceHistory.children.length > 10) {
        practiceHistory.removeChild(practiceHistory.lastChild);
    }
}

// Event Listeners
recordBtn.addEventListener('click', () => {
    if (!isRecording) {
        // Start recording
        audioChunks = [];
        try {
            mediaRecorder.start();
            isRecording = true;
            recordBtn.textContent = 'Stop Recording';
            recordBtn.classList.add('recording');
            recordingStatus.textContent = 'Recording... Speak now';
            recordingStatus.style.color = '#F44336';
        } catch (error) {
            console.error('Error starting recording:', error);
            handleRecordingError();
        }
    } else {
        // Stop recording
        try {
            mediaRecorder.stop();
            isRecording = false;
            recordBtn.textContent = 'Start Recording';
            recordBtn.classList.remove('recording');
            recordingStatus.textContent = 'Processing...';
            recordingStatus.style.color = '#2196F3';
        } catch (error) {
            console.error('Error stopping recording:', error);
            handleRecordingError();
        }
    }
});

difficultySelect.addEventListener('change', (e) => {
    currentDifficulty = e.target.value;
    getNewWord();
});

newWordBtn.addEventListener('click', getNewWord);

// Initialize
window.addEventListener('load', () => {
    initializeRecording();
    getNewWord();
});

// Resize canvas
function resizeCanvas() {
    audioVisualizer.width = audioVisualizer.offsetWidth;
    audioVisualizer.height = audioVisualizer.offsetHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas(); 