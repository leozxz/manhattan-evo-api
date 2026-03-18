import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './layout/AppLayout'
import { useSSE } from './hooks/useSSE'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 },
  },
})

function SSEProvider({ children }: { children: React.ReactNode }) {
  useSSE()
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SSEProvider>
        <AppLayout />
      </SSEProvider>
    </QueryClientProvider>
  )
}
