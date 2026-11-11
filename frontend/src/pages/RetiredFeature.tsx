import { Archive } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

export default function RetiredFeature() {
  return (
    <div className="py-10">
      <EmptyState
        icon={Archive}
        title="This feature is unavailable"
        description="Open Workspace to reach your charts, accounts, and journals."
        action={
          <Button asChild className="mt-4">
            <Link to="/workspace">Open Workspace</Link>
          </Button>
        }
      />
    </div>
  )
}
