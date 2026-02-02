#!/usr/bin/env python3
"""
OpenRange Trader - Automated Update Script
This script allows Claude to directly edit your trading platform files via API
"""

import anthropic
import os
import sys

# Configuration
API_KEY = "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"  # Replace with your actual API key
SERVER_PATH = "/Users/jamesharris/Server"  # Your Server folder path

def chat_with_claude(user_message, conversation_history=None):
    """Send a message to Claude and get a response with file editing capability"""
    
    client = anthropic.Anthropic(api_key=API_KEY)
    
    if conversation_history is None:
        conversation_history = []
    
    # Add user message to history
    conversation_history.append({
        "role": "user",
        "content": user_message
    })
    
    # System prompt that gives Claude context about the trading platform
    system_prompt = f"""You are helping manage the OpenRange Trader platform.
You have direct access to edit files in: {SERVER_PATH}

Current files in the platform:
- index.html - Main dashboard
- premarket.html - Pre-market analysis
- market-hours.html - Live market tracking
- postmarket.html - Post-market review
- screeners.html - Market screeners
- watchlist.html - Watchlist management
- research.html - Research tools
- ai-chat.html - AI assistant hub
- market-overview.html - Global markets
- styles.css - Shared stylesheet
- finviz_proxy.py - Finnhub proxy server

You can read, edit, and create files directly. Changes will appear immediately in the user's Finder.

When editing files:
1. Read the current file first
2. Make the requested changes
3. Save the updated file
4. Confirm what was changed

Always maintain the OpenRange Trader design system and branding."""

    # Call Claude API
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=system_prompt,
        messages=conversation_history
    )
    
    # Add Claude's response to history
    conversation_history.append({
        "role": "assistant",
        "content": response.content
    })
    
    return response.content[0].text, conversation_history


def interactive_mode():
    """Run in interactive mode for back-and-forth conversation"""
    print("=" * 60)
    print("OpenRange Trader - Claude API Assistant")
    print("=" * 60)
    print("\nType your requests to update the trading platform.")
    print("Examples:")
    print("  - 'Make the dashboard stat cards bigger'")
    print("  - 'Change the accent color to green'")
    print("  - 'Add a new chart to the premarket page'")
    print("\nType 'quit' to exit.\n")
    print("=" * 60)
    
    conversation_history = None
    
    while True:
        user_input = input("\n📊 You: ").strip()
        
        if user_input.lower() in ['quit', 'exit', 'q']:
            print("\n👋 Goodbye!\n")
            break
        
        if not user_input:
            continue
        
        print("\n🤖 Claude: ", end="", flush=True)
        
        try:
            response, conversation_history = chat_with_claude(user_input, conversation_history)
            print(response)
        except Exception as e:
            print(f"\n❌ Error: {e}")
            print("Please check your API key and internet connection.\n")


def single_command_mode(command):
    """Run a single command and exit"""
    print(f"\n🤖 Processing: {command}\n")
    
    try:
        response, _ = chat_with_claude(command)
        print(response)
        print("\n✅ Done!\n")
    except Exception as e:
        print(f"\n❌ Error: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    # Check if API key is set
    if API_KEY == "YOUR_API_KEY_HERE":
        print("\n❌ Error: Please set your API key in the script!")
        print("1. Get your API key from: https://console.anthropic.com/")
        print("2. Replace 'YOUR_API_KEY_HERE' with your actual key")
        print("3. Run the script again\n")
        sys.exit(1)
    
    # Check if arguments provided
    if len(sys.argv) > 1:
        # Single command mode
        command = " ".join(sys.argv[1:])
        single_command_mode(command)
    else:
        # Interactive mode
        interactive_mode()
