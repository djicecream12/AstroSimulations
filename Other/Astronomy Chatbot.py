import nltk
import random

# Download necessary NLTK resources
nltk.download('punkt')

# Astronomy facts database
facts = [
    "Did you know? The Sun accounts for 99.86% of the mass in the solar system!",
    "Venus is the hottest planet in our solar system, not Mercury!",
    "Neutron stars are so dense that a sugar-cube-sized amount of their material would weigh as much as all of humanity!",
    "A day on Venus is longer than a year on Venus.",
    "Jupiter has the shortest day of all the planets in the solar system."
]

def get_response(user_input):
    user_input = user_input.lower()
    if "fact" in user_input or "tell me something" in user_input:
        return random.choice(facts)
    elif "hello" in user_input or "hi" in user_input:
        return "Hello! I'm an astronomy chatbot. Ask me for a fact!"
    elif "bye" in user_input or "exit" in user_input:
        return "Goodbye! Keep looking at the stars! 🌌"
    else:
        return "I'm not sure about that. Try asking me for an astronomy fact!"

def chat():
    print("Hello! I'm your astronomy chatbot. Type 'exit' to end the chat.")
    while True:
        user_input = input("You: ")
        if user_input.lower() == "exit":
            print("Chatbot: Goodbye! Keep looking at the stars! 🌌")
            break
        response = get_response(user_input)
        print("Chatbot:", response)

chat()
