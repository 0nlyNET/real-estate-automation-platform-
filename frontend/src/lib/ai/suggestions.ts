export type SuggestionProvider = {
  name: string;
  suggestReply: (context: { lead: string; lastMessage: string }) => Promise<string>;
};

class MockSuggestionProvider implements SuggestionProvider {
  name = 'mock';
  async suggestReply(context: { lead: string; lastMessage: string }): Promise<string> {
    return `Hi ${context.lead.split(' ')[0]}, thanks for reaching out. I can help with ${context.lastMessage}.`;
  }
}

let activeProvider: SuggestionProvider = new MockSuggestionProvider();

export function setSuggestionProvider(provider: SuggestionProvider) {
  activeProvider = provider;
}

export async function getSuggestion(context: { lead: string; lastMessage: string }) {
  return activeProvider.suggestReply(context);
}
