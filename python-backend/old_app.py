from assistant import get_llm_os
import sys
from pathlib import Path
import os

def create_directories():
    """Create necessary directories if they don't exist"""
    Path("tmp/agent_sessions_json").mkdir(parents=True, exist_ok=True)
    Path("tmp").mkdir(parents=True, exist_ok=True)

def initialize_llm_os():
    """Initialize the LLM OS with desired configurations"""
    # Get user_id from environment if available
    user_id = os.getenv("USER_ID")
    
    # Create session info dictionary
    session_info = {
        "session_type": "interactive_chat",
        "created_at": "2025-01-01T00:00:00Z",
        "app_version": "1.0.0"
    }
    
    return get_llm_os(
        user_id=user_id,
        session_info=session_info,
        calculator=True,  # Enable calculator
        internet_search=True,  # Enable internet search (was ddg_search)
        coding_assistant=True,  # Enable coding assistant (was python_assistant)
        investment_assistant=True,  # Enable Investment Assistant
        web_crawler=True,  # Enable web crawler
        use_memory=True,  # Enable memory
        debug_mode=True,  # Enable debug mode for better visibility
        enable_github=False,  # Enable GitHub integration if needed
        enable_google_email=False,  # Enable Google Email if needed
        enable_google_drive=False,  # Enable Google Drive if needed
        enable_structured_output=True,  # Enable structured responses
    )

def run_chat_interface():
    """Run the interactive chat interface using the built-in print_response method"""
    print("\n=== Aetheria AI System ===")
    print("Advanced Multi-Agent AI System")
    print("Type 'exit' or 'quit' to end the conversation")
    print("Type 'clear' to clear the screen")
    print("Type 'help' to see available commands")
    print("===============================\n")

    # Create necessary directories
    create_directories()
    
    # Initialize LLM OS
    try:
        print("Initializing Aetheria AI System...")
        llm_os = initialize_llm_os()
        print("✓ System initialized successfully!\n")
    except Exception as e:
        print(f"❌ Error initializing system: {str(e)}")
        print("Please check your environment variables and try again.")
        sys.exit(1)

    while True:
        try:
            # Get user input
            user_input = input("\nYou: ").strip()

            # Handle special commands
            if user_input.lower() in ['exit', 'quit']:
                print("\n👋 Goodbye! Thank you for using Aetheria AI System.")
                sys.exit(0)
            elif user_input.lower() == 'clear':
                # Clear screen - works on both Windows and Unix-like systems
                print('\033[2J\033[H')
                continue
            elif user_input.lower() == 'help':
                print_help()
                continue
            elif not user_input:
                continue

            # Use the built-in print_response method for clean streaming output
            print("\n🤖 Aetheria AI:", end=" ", flush=True)
            
            # The updated assistant.py uses Team instead of Agent, so we use the team's response method
            llm_os.print_response(user_input, stream=True, markdown=True)

        except KeyboardInterrupt:
            print("\n\n👋 Exiting gracefully...")
            sys.exit(0)
        except Exception as e:
            print(f"\n❌ An error occurred: {str(e)}")
            print("Please try again or type 'help' for assistance.")

def print_help():
    """Print help information about available commands and features"""
    help_text = """
🤖 Aetheria AI System - Help

AVAILABLE COMMANDS:
• exit/quit - Exit the application
• clear - Clear the screen
• help - Show this help message

SYSTEM CAPABILITIES:
• 🧮 Calculator - Mathematical operations and calculations
• 🔍 Internet Search - Web research and information gathering
• 💻 Code Assistant - Code planning, execution, and review
• 📈 Investment Analysis - Financial reports and market insights
• 🌐 Web Crawler - Content extraction and analysis
• 🧠 Memory System - Persistent learning and context retention

SPECIALIZED TEAMS:
• Research Team - Web research, academic papers, content analysis
• Development Team - Code planning, execution, and review
• Integration Team - GitHub, Google services, API operations
• Investment Specialist - Financial analysis and recommendations

USAGE TIPS:
• Ask complex questions - the system coordinates multiple agents
• Request specific analysis types (financial, technical, research)
• Use natural language - no special syntax required
• The system maintains context across conversations
• Multiple agents work together to provide comprehensive responses

EXAMPLES:
• "Analyze Apple stock and provide an investment recommendation"
• "Create a Python script to analyze CSV data"
• "Research the latest developments in quantum computing"
• "Help me plan a machine learning project"
"""
    print(help_text)

if __name__ == "__main__":
    run_chat_interface()