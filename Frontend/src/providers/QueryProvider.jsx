import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

function QueryProvider({ children }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: true,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

export default QueryProvider
