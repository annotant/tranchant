// The kit both pages build on: Annotant's components, copied in one by one,
// Tranchant's palette and font, the theme. Neither page's own code is here:
// the review page and the dashboard share this, never each other's.
import { BUTTON_CSS } from './Button'
import { CHECKBOX_CSS } from './Checkbox'
import { CHIP_CSS } from './Chip'
import { ICON_BUTTON_CSS } from './IconButton'
import { TOKENS_CSS } from './tokens'

export { Button } from './Button'
export { Checkbox } from './Checkbox'
export { Chip } from './Chip'
export { Icon } from './Icon'
export { IconButton } from './IconButton'
export { applyTheme, useTheme } from './theme'

/** The ground and the components' styles, before a page's own. */
export const KIT_CSS = [
  TOKENS_CSS,
  BUTTON_CSS,
  ICON_BUTTON_CSS,
  CHIP_CSS,
  CHECKBOX_CSS,
].join('')
