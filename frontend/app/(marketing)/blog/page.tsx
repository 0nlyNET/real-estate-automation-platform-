"use client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { ArrowRight } from "lucide-react"

const posts = [
  {
    title: "The Science of Speed-to-Lead: Why Response Time Matters",
    excerpt:
      "Research shows that responding within 5 minutes increases conversion by 391%. Here's why timing is everything in real estate.",
    category: "Strategy",
    date: "Jan 5, 2026",
    image: "/speed-clock-business.jpg",
    slug: "speed-to-lead-science",
  },
  {
    title: "5 Automation Sequences Every Agent Needs",
    excerpt:
      "Stop leaving money on the table. These proven follow-up sequences will help you convert more leads on autopilot.",
    category: "Automation",
    date: "Dec 28, 2025",
    image: "/automation-workflow-diagram.png",
    slug: "automation-sequences-agents",
  },
  {
    title: "How Top Teams Use RealtyTechAI to Scale",
    excerpt: "Learn from real estate teams who've 2x'd their production using smart automation and lead routing.",
    category: "Case Study",
    date: "Dec 20, 2025",
    image: "/team-collaboration-office.png",
    slug: "top-teams-case-study",
  },
  {
    title: "Facebook Lead Ads vs. Other Sources: A Data-Driven Comparison",
    excerpt: "We analyzed 100,000 leads to find out which sources convert best. The results might surprise you.",
    category: "Data",
    date: "Dec 15, 2025",
    image: "/data-charts-analytics.jpg",
    slug: "lead-sources-comparison",
  },
  {
    title: "The Ultimate Guide to Real Estate SMS Marketing",
    excerpt: "Text messages have a 98% open rate. Here's how to use SMS effectively without annoying your leads.",
    category: "Marketing",
    date: "Dec 10, 2025",
    image: "/mobile-phone-messaging.jpg",
    slug: "sms-marketing-guide",
  },
  {
    title: "2026 Real Estate Tech Trends to Watch",
    excerpt: "AI, automation, and beyond. Here's what's shaping the future of real estate technology.",
    category: "Trends",
    date: "Dec 5, 2025",
    image: "/futuristic-technology-real-estate.jpg",
    slug: "2026-tech-trends",
  },
]

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      {/* Hero */}
      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              The RealtyTechAI <span className="text-primary">Blog</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              Insights, strategies, and tips to help you close more deals.
            </p>
          </div>
        </div>
      </section>

      {/* Posts */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post, index) => (
              <Card
                key={index}
                className="group overflow-hidden border-border bg-card transition-all duration-200 hover:border-primary/50"
              >
                <div className="aspect-video overflow-hidden">
                  <img
                    src={post.image || "/placeholder.svg"}
                    alt={post.title}
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                </div>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      {post.category}
                    </span>
                    <span className="text-xs text-muted-foreground">{post.date}</span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                    {post.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{post.excerpt}</p>
                  <Button variant="link" className="mt-4 h-auto p-0 text-primary" onClick={() => {}}>
                    Read more
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Button variant="outline" size="lg">
              Load more articles
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
