import { useEffect } from 'react'
import { productName } from '../../shared/product'

export function useDocumentTitle(page: string) {
  useEffect(() => {
    document.title = `${page} | ${productName}`
  }, [page])
}
