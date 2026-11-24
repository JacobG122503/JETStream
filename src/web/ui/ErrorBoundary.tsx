import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  /** A change clears the error. */
  resetKey?: string
  fallback: (retry: () => void) => ReactNode
  children: ReactNode
}

interface State {
  failed: boolean
  resetKey?: string
}

/** Catches errors thrown while its children render. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey }
  }

  render() {
    return this.state.failed ? this.props.fallback(() => this.setState({ failed: false })) : this.props.children
  }
}
