const k = {
  connected: "rtai_connected_sources_v1",
  templates: "rtai_templates_v1",
  sequences: "rtai_sequences_v1",
  unread: "rtai_inbox_unread_v1",
  onboarding: "rtai_onboarding_v1",
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const demoActions = {
  connectSource(source: "Zillow" | "Realtor.com" | "Website Form" | "Facebook Lead Ads") {
    const cur = read<Record<string, boolean>>(k.connected, {});
    cur[source] = true;
    write(k.connected, cur);
    return cur;
  },

  getConnections() {
    return read<Record<string, boolean>>(k.connected, {});
  },

  insertTopTemplates() {
    const cur = read<any[]>(k.templates, []);
    const add = [
      { id: "t1", title: "New lead instant text", body: "Hey {name}, saw your inquiry. Want to tour today or tomorrow?" },
      { id: "t2", title: "Ghosts to ping", body: "Quick check-in {name}, still looking in {area} or did you pause the search?" },
      { id: "t3", title: "Book a showing", body: "Want me to line up 2 options for you? What time works best today?" },
    ];
    const next = [...add, ...cur].slice(0, 12);
    write(k.templates, next);
    return next;
  },

  createDefaultSequence() {
    const cur = read<any[]>(k.sequences, []);
    const seq = {
      id: `seq_${Date.now()}`,
      name: "New Internet Lead",
      steps: [
        { t: "0m", channel: "sms", text: "Hey {name} it’s Jayden. Want to tour today or tomorrow?" },
        { t: "15m", channel: "email", text: "Quick follow-up: what’s your ideal move-in timeline?" },
        { t: "24h", channel: "sms", text: "Still looking? I can send 3 matches in your price range." },
      ],
    };
    const next = [seq, ...cur].slice(0, 20);
    write(k.sequences, next);
    return seq;
  },

  seedUnread(count = 7) {
    write(k.unread, count);
    return count;
  },

  getUnread() {
    return read<number>(k.unread, 0);
  },

  markAllUnreadAsRead() {
    write(k.unread, 0);
    return 0;
  },

  setOnboarding(step: 1 | 2 | 3) {
    write(k.onboarding, { step, updatedAt: Date.now() });
  },

  getOnboarding() {
    return read<{ step: 1 | 2 | 3 }>(k.onboarding, { step: 1 });
  },
};
