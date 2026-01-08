"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { useToast } from "@/hooks/use-toast"
import { Mail, Phone, MapPin, Calendar, ArrowRight, Loader2 } from "lucide-react"

export default function ContactPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    // Simulate form submission
    await new Promise((resolve) => setTimeout(resolve, 1500))

    setLoading(false)
    toast({
      title: "Message sent!",
      description: "We'll get back to you within 24 hours.",
    })
  }

  const handleBookDemo = () => {
    toast({
      title: "Opening calendar...",
      description: "You'll be redirected to our booking page.",
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      {/* Hero */}
      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Get in <span className="text-primary">touch</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              Have questions? We'd love to hear from you. Send us a message or book a demo.
            </p>
          </div>
        </div>
      </section>

      {/* Contact Form + Info */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2">
            {/* Form */}
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-foreground">Send us a message</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="firstName" className="text-foreground">
                        First name
                      </Label>
                      <Input id="firstName" placeholder="John" required className="bg-secondary" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName" className="text-foreground">
                        Last name
                      </Label>
                      <Input id="lastName" placeholder="Doe" required className="bg-secondary" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-foreground">
                      Email
                    </Label>
                    <Input id="email" type="email" placeholder="john@example.com" required className="bg-secondary" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="company" className="text-foreground">
                      Company
                    </Label>
                    <Input id="company" placeholder="Your brokerage or team name" className="bg-secondary" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="topic" className="text-foreground">
                      Topic
                    </Label>
                    <Select>
                      <SelectTrigger className="bg-secondary">
                        <SelectValue placeholder="Select a topic" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sales">Sales inquiry</SelectItem>
                        <SelectItem value="support">Technical support</SelectItem>
                        <SelectItem value="demo">Request a demo</SelectItem>
                        <SelectItem value="partnership">Partnership</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="message" className="text-foreground">
                      Message
                    </Label>
                    <Textarea
                      id="message"
                      placeholder="How can we help you?"
                      rows={5}
                      required
                      className="bg-secondary"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        Send message
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Info */}
            <div className="space-y-8">
              <Card className="border-border bg-card">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Calendar className="h-6 w-6" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground">Book a demo</h3>
                      <p className="text-sm text-muted-foreground">
                        See RealtyTechAI in action with a personalized walkthrough.
                      </p>
                    </div>
                    <Button variant="outline" onClick={handleBookDemo} className="shrink-0 bg-transparent">
                      Schedule
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Email</h3>
                    <p className="text-muted-foreground">hello@realtytechai.com</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Phone</h3>
                    <p className="text-muted-foreground">+1 (555) 123-4567</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Office</h3>
                    <p className="text-muted-foreground">
                      123 Tech Lane, Suite 400
                      <br />
                      Austin, TX 78701
                    </p>
                  </div>
                </div>
              </div>

              <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card">
                <CardContent className="p-6">
                  <h3 className="font-semibold text-foreground">Response times</h3>
                  <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-center justify-between">
                      <span>Sales inquiries</span>
                      <span className="text-primary">Within 2 hours</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>Technical support (Pro)</span>
                      <span className="text-primary">Within 4 hours</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>Technical support (Team)</span>
                      <span className="text-primary">Within 1 hour</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>General inquiries</span>
                      <span className="text-primary">Within 24 hours</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
