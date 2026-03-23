import { useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAppStore } from '@/stores/app.store'

let socketInstance: Socket | null = null

function getSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io('/', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    })
  }
  return socketInstance
}

export function useSocket() {
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus)
  const socketRef = useRef<Socket>(getSocket())

  useEffect(() => {
    const socket = socketRef.current

    const onConnect = () => setConnectionStatus('connected')
    const onDisconnect = () => setConnectionStatus('disconnected')
    const onConnecting = () => setConnectionStatus('connecting')

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('reconnect_attempt', onConnecting)

    // Sync initial state
    if (socket.connected) setConnectionStatus('connected')
    else setConnectionStatus('disconnected')

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('reconnect_attempt', onConnecting)
    }
  }, [setConnectionStatus])

  const emit = useCallback(<T>(event: string, data?: T) => {
    socketRef.current.emit(event, data)
  }, [])

  const on = useCallback(<T>(event: string, handler: (data: T) => void) => {
    socketRef.current.on(event, handler)
    return () => { socketRef.current.off(event, handler) }
  }, [])

  const off = useCallback((event: string, handler?: (...args: unknown[]) => void) => {
    socketRef.current.off(event, handler)
  }, [])

  return { socket: socketRef.current, emit, on, off }
}
