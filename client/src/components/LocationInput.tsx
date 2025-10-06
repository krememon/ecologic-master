import { useEffect, useRef } from 'react'
import { Loader } from '@googlemaps/js-api-loader'
import { Input } from "@/components/ui/input";

type Address = {
  street: string
  city: string
  state: string
  postalCode: string
  country: string
  place_id: string
  formatted_address: string
}

export default function LocationInput({
  value,
  onChange,
  onAddressSelected,
  placeholder = 'Start typing an address…',
  disabled = false,
  className,
}: {
  value: string
  onChange: (v: string) => void
  onAddressSelected: (a: Address) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const acRef = useRef<google.maps.places.Autocomplete | null>(null)

  useEffect(() => {
    let mounted = true
    const loader = new Loader({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY!,
      libraries: ['places'],
    })

    loader.load().then(() => {
      if (!mounted || !inputRef.current) return
      // Use session token to reduce costs & improve relevance
      const sessionToken = new google.maps.places.AutocompleteSessionToken()
      const ac = new google.maps.places.Autocomplete(inputRef.current!, {
        fields: ['address_components', 'formatted_address', 'place_id'],
        types: ['address'],
      })
      ;(ac as any).setOptions?.({ sessionToken })
      ac.addListener('place_changed', () => {
        const p = ac.getPlace()
        if (!p || !p.address_components) return
        const get = (t: string) =>
          p.address_components!.find(c => c.types.includes(t))?.long_name || ''
        const streetNumber = get('street_number')
        const route = get('route')
        const city = get('locality') || get('sublocality') || get('postal_town')
        const state = get('administrative_area_level_1')
        const postalCode = get('postal_code')
        const country = get('country')
        onAddressSelected({
          street: [streetNumber, route].filter(Boolean).join(' ').trim(),
          city,
          state,
          postalCode,
          country,
          place_id: p.place_id || '',
          formatted_address: p.formatted_address || '',
        })
      })
      acRef.current = ac
    })

    return () => {
      mounted = false
      acRef.current = null
    }
  }, [onAddressSelected])

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      autoComplete="off"
      inputMode="text"
      data-testid="input-location"
    />
  )
}
