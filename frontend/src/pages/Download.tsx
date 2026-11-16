import { BookOpen, Github } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

const repositoryUrl = 'https://github.com/arpanjot-coding/chartly-trading-workspace'

export default function Download() {
  return (
    <main className="container mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold">Install Chartly</h1>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-muted-foreground">
            Build and run the self-hosted Chartly app from its public source repository.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <a href={`${repositoryUrl}#quick-start`}>
                <BookOpen aria-hidden="true" />
                Setup guide
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={repositoryUrl}>
                <Github aria-hidden="true" />
                View source
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
