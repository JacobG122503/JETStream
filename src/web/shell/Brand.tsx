import { Link } from 'react-router-dom'
import { productName } from '../../shared/product'
import { BrandMark } from './BrandMark'

export function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <Link to="/time" className="brand" onClick={onClick}>
      <BrandMark />
      <span className="brand-text">
        <span className="brand-name">{productName}</span>
        <span className="brand-owner">by JET Engineering</span>
      </span>
    </Link>
  )
}
