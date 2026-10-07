import { API_UNREACHABLE } from '../api/client'
import { useI18n } from '../i18n'

export default function ErrorNotice({ message }: { message: string | null | undefined }) {
  const { t } = useI18n()
  if (!message) return null
  return <div className="notice error">{message === API_UNREACHABLE ? t('api.unreachable') : message}</div>
}
