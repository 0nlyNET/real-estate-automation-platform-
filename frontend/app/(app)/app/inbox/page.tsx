"use client"

import { useState, useEffect } from "react"
import { AppShell } from "@/components/app-shell/app-shell"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import {
  Search,
  Mail,
  MessageSquare,
  Phone,
  Star,
  Archive,
  Trash2,
  Send,
  Paperclip,
  MoreHorizontal,
  ChevronLeft,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Channel = "all" | "email" | "sms" | "call"

interface Message {
  id: string
  sender: string
  senderInitials: string
  channel: "email" | "sms" | "call"
  subject?: string
  preview: string
  time: string
  unread: boolean
  starred: boolean
  thread: Array<{
    id: string
    from: string
    content: string
    time: string
    isMe: boolean
  }>
}

const mockMessages: Message[] = [
  {
    id: "1",
    sender: "Sarah Johnson",
    senderInitials: "SJ",
    channel: "email",
    subject: "Re: 3BR Downtown Listings",
    preview:
      "Thanks for sending over those listings! I'm particularly interested in the one on Oak Street. Can we schedule a viewing?",
    time: "2 min ago",
    unread: true,
    starred: true,
    thread: [
      {
        id: "1a",
        from: "Sarah Johnson",
        content: "Hi! I'm looking for a 3BR home in the downtown area with a budget of $500k-600k.",
        time: "Yesterday, 10:30 AM",
        isMe: false,
      },
      {
        id: "1b",
        from: "You",
        content: "Hi Sarah! I've found some great options for you. Here are 5 listings that match your criteria.",
        time: "Yesterday, 11:45 AM",
        isMe: true,
      },
      {
        id: "1c",
        from: "Sarah Johnson",
        content:
          "Thanks for sending over those listings! I'm particularly interested in the one on Oak Street. Can we schedule a viewing?",
        time: "2 min ago",
        isMe: false,
      },
    ],
  },
  {
    id: "2",
    sender: "Mike Chen",
    senderInitials: "MC",
    channel: "sms",
    preview: "Yes, tomorrow at 3pm works for me. See you then!",
    time: "1 hour ago",
    unread: true,
    starred: false,
    thread: [
      {
        id: "2a",
        from: "You",
        content: "Hi Mike, just following up on our conversation. Would tomorrow at 3pm work for the property tour?",
        time: "2 hours ago",
        isMe: true,
      },
      {
        id: "2b",
        from: "Mike Chen",
        content: "Yes, tomorrow at 3pm works for me. See you then!",
        time: "1 hour ago",
        isMe: false,
      },
    ],
  },
  {
    id: "3",
    sender: "Emily Davis",
    senderInitials: "ED",
    channel: "call",
    preview: "Missed call - 5 minutes",
    time: "3 hours ago",
    unread: false,
    starred: false,
    thread: [
      {
        id: "3a",
        from: "System",
        content: "Missed call from Emily Davis. Duration: 0:00. Left voicemail.",
        time: "3 hours ago",
        isMe: false,
      },
    ],
  },
  {
    id: "4",
    sender: "John Williams",
    senderInitials: "JW",
    channel: "email",
    subject: "Offer Accepted!",
    preview: "Great news! The seller has accepted your offer on 456 Pine Avenue. Let's discuss next steps.",
    time: "5 hours ago",
    unread: false,
    starred: true,
    thread: [
      {
        id: "4a",
        from: "You",
        content: "Hi John, I'm pleased to let you know that the seller has accepted your offer on 456 Pine Avenue!",
        time: "5 hours ago",
        isMe: true,
      },
      {
        id: "4b",
        from: "John Williams",
        content: "That's amazing news! What are the next steps?",
        time: "4 hours ago",
        isMe: false,
      },
    ],
  },
  {
    id: "5",
    sender: "Lisa Park",
    senderInitials: "LP",
    channel: "sms",
    preview: "Thank you so much for everything! We love our new home.",
    time: "1 day ago",
    unread: false,
    starred: true,
    thread: [
      {
        id: "5a",
        from: "Lisa Park",
        content: "Thank you so much for everything! We love our new home.",
        time: "1 day ago",
        isMe: false,
      },
    ],
  },
]

const channelIcons = {
  email: Mail,
  sms: MessageSquare,
  call: Phone,
}

export default function InboxPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [messages, setMessages] = useState<Message[]>(mockMessages)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeChannel, setActiveChannel] = useState<Channel>("all")
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const [replyText, setReplyText] = useState("")
  const [showThreadOnMobile, setShowThreadOnMobile] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  const filteredMessages = messages.filter((msg) => {
    const matchesSearch =
      msg.sender.toLowerCase().includes(searchQuery.toLowerCase()) ||
      msg.preview.toLowerCase().includes(searchQuery.toLowerCase()) ||
      msg.subject?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesChannel = activeChannel === "all" || msg.channel === activeChannel
    return matchesSearch && matchesChannel
  })

  const unreadCount = messages.filter((m) => m.unread).length

  const handleSelectMessage = (msg: Message) => {
    setSelectedMessage(msg)
    setShowThreadOnMobile(true)
    if (msg.unread) {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, unread: false } : m)))
    }
  }

  const handleStar = (id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, starred: !m.starred } : m)))
  }

  const handleArchive = (id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id))
    if (selectedMessage?.id === id) setSelectedMessage(null)
    toast({ title: "Archived", description: "Message has been archived." })
  }

  const handleDelete = (id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id))
    if (selectedMessage?.id === id) setSelectedMessage(null)
    toast({ title: "Deleted", description: "Message has been deleted." })
  }

  const handleSendReply = () => {
    if (!replyText.trim() || !selectedMessage) return
    toast({ title: "Sent", description: "Your reply has been sent." })
    setReplyText("")
  }

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Inbox</h1>
            <p className="text-muted-foreground">{unreadCount} unread messages</p>
          </div>
        </div>

        {/* Main Content */}
        <Card className="flex-1 border-border bg-card overflow-hidden">
          <div className="flex h-full">
            {/* Message List */}
            <div
              className={cn(
                "w-full md:w-96 border-r border-border flex flex-col",
                showThreadOnMobile && selectedMessage ? "hidden md:flex" : "flex",
              )}
            >
              {/* Filters */}
              <div className="p-4 border-b border-border space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search messages..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-secondary pl-9"
                  />
                </div>
                <Tabs value={activeChannel} onValueChange={(v) => setActiveChannel(v as Channel)}>
                  <TabsList className="grid w-full grid-cols-4 bg-secondary">
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="email">Email</TabsTrigger>
                    <TabsTrigger value="sms">SMS</TabsTrigger>
                    <TabsTrigger value="call">Calls</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {/* Message List */}
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="p-4 border-b border-border">
                      <div className="flex gap-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-full" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      </div>
                    </div>
                  ))
                ) : filteredMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                    <Mail className="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <h3 className="text-lg font-medium text-foreground">No messages</h3>
                    <p className="text-muted-foreground mt-1">Your inbox is empty.</p>
                  </div>
                ) : (
                  filteredMessages.map((msg) => {
                    const ChannelIcon = channelIcons[msg.channel]
                    return (
                      <div
                        key={msg.id}
                        onClick={() => handleSelectMessage(msg)}
                        className={cn(
                          "p-4 border-b border-border cursor-pointer transition-colors hover:bg-secondary/50",
                          selectedMessage?.id === msg.id && "bg-secondary/50",
                          msg.unread && "bg-primary/5",
                        )}
                      >
                        <div className="flex gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarFallback className="bg-primary/10 text-primary text-sm">
                              {msg.senderInitials}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={cn("font-medium truncate", msg.unread && "text-foreground")}>
                                  {msg.sender}
                                </span>
                                <ChannelIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              </div>
                              <span className="text-xs text-muted-foreground flex-shrink-0">{msg.time}</span>
                            </div>
                            {msg.subject && (
                              <p className="text-sm font-medium text-foreground truncate">{msg.subject}</p>
                            )}
                            <p className="text-sm text-muted-foreground truncate">{msg.preview}</p>
                            <div className="flex items-center gap-2 mt-1">
                              {msg.unread && <Badge className="bg-primary/10 text-primary text-xs h-5">New</Badge>}
                              {msg.starred && <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Thread View */}
            <div
              className={cn(
                "flex-1 flex flex-col",
                !showThreadOnMobile || !selectedMessage ? "hidden md:flex" : "flex",
              )}
            >
              {selectedMessage ? (
                <>
                  {/* Thread Header */}
                  <div className="p-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="md:hidden"
                        onClick={() => setShowThreadOnMobile(false)}
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </Button>
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {selectedMessage.senderInitials}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-foreground">{selectedMessage.sender}</p>
                        <p className="text-sm text-muted-foreground">
                          {selectedMessage.subject || selectedMessage.channel.toUpperCase()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleStar(selectedMessage.id)}>
                        <Star className={cn("h-4 w-4", selectedMessage.starred && "text-yellow-500 fill-yellow-500")} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleArchive(selectedMessage.id)}>
                        <Archive className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(selectedMessage.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Thread Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {selectedMessage.thread.map((item) => (
                      <div key={item.id} className={cn("flex", item.isMe ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[80%] rounded-lg p-3",
                            item.isMe ? "bg-primary text-primary-foreground" : "bg-secondary",
                          )}
                        >
                          <p className="text-sm">{item.content}</p>
                          <p
                            className={cn(
                              "text-xs mt-1",
                              item.isMe ? "text-primary-foreground/70" : "text-muted-foreground",
                            )}
                          >
                            {item.time}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Reply Box */}
                  <div className="p-4 border-t border-border">
                    <div className="flex gap-2">
                      <Textarea
                        placeholder="Type your reply..."
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        className="bg-secondary resize-none"
                        rows={3}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <Button variant="ghost" size="icon">
                        <Paperclip className="h-4 w-4" />
                      </Button>
                      <Button onClick={handleSendReply} disabled={!replyText.trim()}>
                        <Send className="h-4 w-4 mr-2" />
                        Send
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <Mail className="h-16 w-16 text-muted-foreground/30 mb-4" />
                  <h3 className="text-lg font-medium text-foreground">Select a message</h3>
                  <p className="text-muted-foreground mt-1">Choose a conversation from the list to view details.</p>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
