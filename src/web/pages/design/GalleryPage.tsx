import { useEffect } from 'react'
import { productName } from '../../../shared/product'
import { Page } from '../../shell/Page'
import { ServerStatus } from '../../ServerStatus'
import { ButtonsSection } from './ButtonsSection'
import { ComboboxSection, DatesSection } from './ChoosersSection'
import { DisplaySection, LongTextSection, StatesSection } from './DisplaySection'
import { FormsSection } from './FormsSection'
import { FoundationsSection } from './FoundationsSection'
import { OverlaysSection, ToastsSection } from './OverlaysSection'
import { Example, Section } from './Section'
import { TablesSection } from './TablesSection'
import './gallery.css'

const sections = [
  ['foundations', 'Foundations'],
  ['buttons', 'Buttons'],
  ['forms', 'Forms'],
  ['combobox', 'Combobox'],
  ['dates', 'Dates'],
  ['tables', 'Tables'],
  ['overlays', 'Dialogs, menus, tooltips'],
  ['toasts', 'Toasts'],
  ['display', 'Display'],
  ['states', 'States'],
  ['long-text', 'Long text'],
  ['server', 'Server'],
] as const

/** Every shared component in all its variants and states. Not in the navigation. */
export function GalleryPage() {
  // The browser looks for the fragment before the page is there.
  useEffect(() => {
    const target = window.location.hash.slice(1)
    if (target) document.getElementById(target)?.scrollIntoView()
  }, [])

  return (
    <Page title="Design system" description={`The shared components of ${productName}, for people who build and check it. Everything here is sample data: the people, companies and figures are fictional.`}>
      <nav aria-label="Sections of this page" className="gallery-index no-print">
        <ul>
          {sections.map(([id, title]) => (
            <li key={id}>
              <a href={`#${id}`}>{title}</a>
            </li>
          ))}
        </ul>
      </nav>
      <FoundationsSection />
      <ButtonsSection />
      <FormsSection />
      <ComboboxSection />
      <DatesSection />
      <TablesSection />
      <OverlaysSection />
      <ToastsSection />
      <DisplaySection />
      <StatesSection />
      <LongTextSection />
      <Section id="server" title="Server">
        <Example title="Connection" note="Real, not a sample: whether the server and its database answer.">
          <ServerStatus />
        </Example>
      </Section>
    </Page>
  )
}
