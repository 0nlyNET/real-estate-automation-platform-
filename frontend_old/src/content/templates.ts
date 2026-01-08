export type AutomationTemplate = {
  key: string;
  name: string;
  description: string;
  channel: "sms" | "email" | "mixed";
  rules: string[];
  sms?: { message: string };
  email?: { subject: string; body: string };
  steps?: Array<{
    offsetLabel: string;
    channel: "sms" | "email";
    message?: string;
    subject?: string;
    body?: string;
  }>;
};

export const automationTemplates: AutomationTemplate[] = [
  {
    key: "instant_sms",
    name: "Instant text",
    description: "Sends the moment a new lead comes in.",
    channel: "sms",
    rules: ["Stops when they reply", "Only sends during quiet hours"],
    sms: {
      message:
        "Hey {{firstName}}, it’s {{agentName}}. I just saw your request about {{interest}}. Are you looking to buy or sell right now?",
    },
  },
  {
    key: "instant_email",
    name: "Instant email",
    description: "A quick intro email so you hit every inbox.",
    channel: "email",
    rules: ["Stops when they reply", "Only sends during quiet hours"],
    email: {
      subject: "Quick question about your home search",
      body:
        "Hi {{firstName}},\n\nI’m {{agentName}}. I can help with {{interest}}. What area and price range are you aiming for?\n\nTalk soon,\n{{agentName}}",
    },
  },
  {
    key: "no_reply_followups",
    name: "No response follow-ups",
    description: "Keeps checking in until they respond.",
    channel: "mixed",
    rules: ["Stops the moment they reply", "Only sends during quiet hours"],
    steps: [
      {
        offsetLabel: "+2 hours",
        channel: "sms",
        message: "Just checking in. Do you want a quick call today or tomorrow?",
      },
      {
        offsetLabel: "Next day",
        channel: "email",
        subject: "Want me to send a few options?",
        body:
          "Hi {{firstName}},\n\nWant me to send a few options in your budget? Tell me your ideal area and price range and I’ll put together a quick list.\n\n- {{agentName}}",
      },
      {
        offsetLabel: "+3 days",
        channel: "sms",
        message: "Still looking in {{area}} or did your plans change?",
      },
      {
        offsetLabel: "+7 days",
        channel: "sms",
        message:
          "Last check-in. Should I close your request or keep sending options?",
      },
    ],
  },
  {
    key: "review_request",
    name: "Review request",
    description: "Asks for a review after you close a deal.",
    channel: "sms",
    rules: ["Only sends when deal is marked Closed"],
    sms: {
      message:
        "{{firstName}}, working with you was awesome. Could you leave a quick review? It helps a ton: {{reviewLink}}",
    },
  },
];
