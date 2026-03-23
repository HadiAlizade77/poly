import { Routes, Route } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'

const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Markets = lazy(() => import('@/pages/Markets'))
const Scorers = lazy(() => import('@/pages/Scorers'))
const Decisions = lazy(() => import('@/pages/Decisions'))
const Orders = lazy(() => import('@/pages/Orders'))
const Positions = lazy(() => import('@/pages/Positions'))
const Risk = lazy(() => import('@/pages/Risk'))
const Analytics = lazy(() => import('@/pages/Analytics'))
const Settings = lazy(() => import('@/pages/Settings'))
const Health = lazy(() => import('@/pages/Health'))

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
      Loading…
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route
          index
          element={
            <Suspense fallback={<PageFallback />}>
              <Dashboard />
            </Suspense>
          }
        />
        <Route
          path="markets"
          element={
            <Suspense fallback={<PageFallback />}>
              <Markets />
            </Suspense>
          }
        />
        <Route
          path="scorers"
          element={
            <Suspense fallback={<PageFallback />}>
              <Scorers />
            </Suspense>
          }
        />
        <Route
          path="decisions"
          element={
            <Suspense fallback={<PageFallback />}>
              <Decisions />
            </Suspense>
          }
        />
        <Route
          path="orders"
          element={
            <Suspense fallback={<PageFallback />}>
              <Orders />
            </Suspense>
          }
        />
        <Route
          path="positions"
          element={
            <Suspense fallback={<PageFallback />}>
              <Positions />
            </Suspense>
          }
        />
        <Route
          path="risk"
          element={
            <Suspense fallback={<PageFallback />}>
              <Risk />
            </Suspense>
          }
        />
        <Route
          path="analytics"
          element={
            <Suspense fallback={<PageFallback />}>
              <Analytics />
            </Suspense>
          }
        />
        <Route
          path="settings"
          element={
            <Suspense fallback={<PageFallback />}>
              <Settings />
            </Suspense>
          }
        />
        <Route
          path="health"
          element={
            <Suspense fallback={<PageFallback />}>
              <Health />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  )
}
