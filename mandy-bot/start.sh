#!/bin/bash
# Load environment variables from .env file if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Activate virtual environment
source .venv/bin/activate

# Start the server
uvicorn server:app --reload --port 8001
