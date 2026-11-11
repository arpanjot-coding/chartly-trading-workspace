import { Download, HelpCircle, Menu, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Footer } from '@/components/layout/Footer'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useThemeStore } from '@/stores/themeStore'

const faqData = [
  {
    category: 'General',
    questions: [
      {
        question: 'What is Chartly?',
        answer:
          'Chartly is an open-source algorithmic trading platform that provides a unified API layer across 36 broker plugins: 35 securities integrations and Delta Exchange for crypto derivatives. It enables seamless integration with TradingView, Amibroker, Excel, Python, and AI agents, allowing traders to automate their trading strategies without being locked into a single broker.',
      },
      {
        question: 'Which brokers are supported?',
        answer:
          'Chartly supports 36 broker plugins: 5 Paisa, 5 Paisa (XTS), Alice Blue, Angel One, Arrow, CompositEdge, Definedge, Delta Exchange, Dhan, Dhan (Sandbox), Firstock, Flattrade, Fyers, Groww, HDFC Securities, HDFC Sky, Ibulls, IIFL, IIFL Capital, IndMoney, JainamXts, Kotak Securities, Motilal Oswal, mStock by Mirae Asset, Nubra, Paytm Money, Pocketful, RMoney, Samco, Shoonya (Finvasia), TradeSmart, Tradejini, Upstox, Wisdom Capital, Zebu and Zerodha. Delta Exchange is a crypto exchange; the rest are Indian brokers. New brokers are being added regularly.',
      },
      {
        question: 'What are the system requirements?',
        answer:
          'Chartly requires Python 3.12 or higher and Node.js 20+ for the frontend. It runs on Windows, macOS, and Linux. For optimal performance, we recommend at least 4GB RAM and a stable internet connection. The application uses SQLite by default, making it lightweight and easy to deploy.',
      },
      {
        question: 'Where can I host Chartly?',
        answer:
          'Chartly can be hosted locally on your personal computer, on a VPS (Virtual Private Server), or in the cloud. Popular options include AWS, Google Cloud, DigitalOcean, or any Linux VPS provider. For Indian traders, hosting on an Indian VPS ensures low latency connections to broker servers.',
      },
    ],
  },
  {
    category: 'Costs & Security',
    questions: [
      {
        question: 'What are the costs involved?',
        answer:
          'Chartly is completely free and open-source under the AGPL license. There are no licensing fees, subscription costs, or hidden charges. You only pay for your hosting infrastructure (if using cloud/VPS) and standard brokerage charges from your broker. Self-hosting on your own computer is completely free.',
      },
      {
        question: 'How secure is Chartly?',
        answer:
          'Security is a top priority. Chartly stores API credentials locally on your machine with encryption. It uses HTTPS for all communications, implements CSRF protection, rate limiting, and secure session management. Since it runs on your own infrastructure, you have complete control over your data. We recommend using strong passwords and enabling 2FA where available.',
      },
      {
        question: 'Why do I need to login daily?',
        answer:
          'Daily login is required by Indian brokers for security compliance. Broker sessions typically expire at the end of each trading day or after a set period (usually around 3 AM IST). This is a regulatory requirement, not an Chartly limitation. The platform makes re-authentication quick and easy with TOTP support for most brokers.',
      },
    ],
  },
  {
    category: 'Features & Integration',
    questions: [
      {
        question: 'Which platforms can I integrate with Chartly?',
        answer:
          'Chartly integrates with TradingView (via webhooks), Amibroker (via AFL), GoCharting, ChartInk, MetaTrader, Excel, Google Sheets, Python, Node.js, Go, N8N, and any platform that can send HTTP webhooks. You can also use the REST API directly from any programming language.',
      },
      {
        question: 'Does Chartly support sandbox trading?',
        answer:
          'Yes! Chartly includes an Analyzer/Sandbox mode with sandbox capital of Rs. 1 Crore. This allows you to test strategies in a realistic environment with proper margin calculations, auto square-off at exchange timings, and complete isolation from live trading. Perfect for testing before going live.',
      },
      {
        question: 'Can I run multiple strategies simultaneously?',
        answer:
          'Yes, Chartly supports running multiple strategies simultaneously. You can create different webhook endpoints for different strategies, manage them independently, and monitor their performance through the dashboard. The Action Center allows you to control execution modes for each strategy.',
      },
      {
        question: 'Does Chartly provide real-time market data?',
        answer:
          'Yes, Chartly includes a unified WebSocket server that streams real-time market data from your broker. This data is used for live position tracking, P&L updates, and can be accessed by your strategies. The data is normalized across all brokers for consistent handling.',
      },
    ],
  },
  {
    category: 'Licensing & Usage',
    questions: [
      {
        question: 'Can I use Chartly for my proprietary trading strategies?',
        answer:
          'Yes, you can use Chartly for your personal or proprietary trading strategies. The AGPL license allows free use for personal trading. However, if you modify Chartly and provide it as a service to others, you must make your modifications open source.',
      },
      {
        question: 'Can I rebrand Chartly for commercial use?',
        answer:
          'Under the AGPL license, you can modify Chartly, but any derivative work must also be open source and credit the original project. For commercial licensing options that allow rebranding without open-source requirements, please contact the Chartly team.',
      },
      {
        question: 'Can I charge others for using my Chartly setup?',
        answer:
          'If you provide Chartly as a service to others (even if modified), the AGPL license requires you to share your source code. For commercial service offerings without this requirement, commercial licensing options are available.',
      },
      {
        question: 'Can I integrate Chartly with GPT/AI assistants?',
        answer:
          'Yes! Chartly provides REST APIs that can be called from AI assistants, chatbots, or any automated system. You can build AI-powered trading assistants that use Chartly to execute trades based on natural language commands or AI analysis.',
      },
    ],
  },
]

export default function Faq() {
  const { mode, toggleMode } = useThemeStore()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const navLinks = [
    { href: '/workspace', label: 'Workspace', internal: true },
    { href: '/faq', label: 'FAQ', internal: true },
  ]

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Navbar */}
      <header className="sticky top-0 z-30 h-16 w-full border-b bg-background/90 backdrop-blur">
        <nav className="container mx-auto px-4 flex h-full items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            {/* Mobile menu button */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="lg:hidden">
                <Button variant="ghost" size="icon" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80">
                <SheetHeader className="sr-only">
                  <SheetTitle>Navigation Menu</SheetTitle>
                  <SheetDescription>Main navigation and quick access links</SheetDescription>
                </SheetHeader>
                <div className="flex items-center gap-2 mb-8">
                  <img src="/logo.png" alt="Chartly" className="h-8 w-8" />
                  <span className="text-xl font-semibold">Chartly</span>
                </div>
                <div className="flex flex-col gap-2">
                  <Link
                    to="/workspace"
                    className="flex items-center gap-2 px-4 py-2 rounded-md hover:bg-accent"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                      />
                    </svg>
                    Workspace
                  </Link>
                  <Link
                    to="/faq"
                    className="flex items-center gap-2 px-4 py-2 rounded-md hover:bg-accent"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <HelpCircle className="h-5 w-5" />
                    FAQ
                  </Link>
                  <Link
                    to="/download"
                    className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Download className="h-5 w-5" />
                    Download
                  </Link>
                </div>
              </SheetContent>
            </Sheet>

            <Link to="/workspace" className="flex items-center gap-2">
              <img src="/logo.png" alt="Chartly" className="h-8 w-8" />
              <span className="text-xl font-bold hidden sm:inline">Chartly</span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) =>
              link.internal ? (
                <Link key={link.href} to={link.href}>
                  <Button variant="ghost" size="sm">
                    {link.label}
                  </Button>
                </Link>
              ) : (
                <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="sm">
                    {link.label}
                  </Button>
                </a>
              )
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <Link to="/download">
              <Button size="sm">Download</Button>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleMode}
              aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {mode === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          </div>
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <div className="container mx-auto px-4 py-12">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-4xl lg:text-5xl font-bold mb-4">Frequently Asked Questions</h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Find answers to common questions about Chartly, its features, security, and
              licensing.
            </p>
          </div>

          {/* FAQ Categories */}
          <div className="max-w-4xl mx-auto space-y-8">
            {faqData.map((category) => (
              <Card key={category.category}>
                <CardHeader>
                  <CardTitle>{category.category}</CardTitle>
                  <CardDescription>
                    {category.category === 'General' && 'Basic information about Chartly'}
                    {category.category === 'Costs & Security' &&
                      'Pricing, security, and compliance details'}
                    {category.category === 'Features & Integration' &&
                      'Platform capabilities and integrations'}
                    {category.category === 'Licensing & Usage' &&
                      'License terms and usage guidelines'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible className="w-full">
                    {category.questions.map((faq, index) => (
                      <AccordionItem key={index} value={`${category.category}-${index}`}>
                        <AccordionTrigger className="text-left">{faq.question}</AccordionTrigger>
                        <AccordionContent className="text-muted-foreground">
                          {faq.answer}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mx-auto mt-16 max-w-4xl border bg-card p-6 text-center">
            <h2 className="text-2xl font-bold">Need more help?</h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Start from Workspace: open a trading profile, then use its Connections, Chart, and
              Journal tabs. If a tool asks for a key, generate your Chartly API key once.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link to="/workspace">Open Workspace</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/apikey">Get API key</Link>
              </Button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  )
}
