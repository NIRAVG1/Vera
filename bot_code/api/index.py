import sys
import os

# Add bot_code/ to path so bot.py can import composer, store, validators, etc.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot import app
