# AI Speech Improvement Assistant

A web application designed to help deaf individuals improve their speaking skills using AI-powered speech recognition and feedback.

## Features

- Real-time speech recording and visualization
- AI-powered speech recognition
- Instant pronunciation feedback
- Practice word suggestions
- Progress tracking
- Beautiful and intuitive user interface

## Prerequisites

- Python 3.7 or higher
- pip (Python package manager)
- Modern web browser with microphone support

## Installation

1. Clone this repository:
```bash
git clone <repository-url>
cd <repository-name>
```

2. Create a virtual environment (recommended):
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install the required packages:
```bash
pip install -r requirements.txt
```

## Running the Application

1. Start the Flask server:
```bash
python app.py
```

2. Open your web browser and navigate to:
```
http://localhost:5000
```

## Usage

1. Click the "New Word" button to get a new practice word
2. Click the "Start Recording" button to begin recording your speech
3. Speak the displayed word clearly into your microphone
4. Click "Stop Recording" when finished
5. Wait for the AI to analyze your speech and provide feedback
6. View your pronunciation score and feedback
7. Practice history is automatically saved and displayed below

## Technical Details

- Frontend: HTML5, CSS3, JavaScript
- Backend: Python Flask
- Speech Recognition: Google Speech Recognition API
- Audio Processing: Web Audio API
- Visualization: HTML5 Canvas

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 