import {
  IconBolt, IconBuilding, IconCar, IconChecklist, IconDroplet, IconFlame, IconHome,
  IconReceipt, IconShield, IconTool, IconWifi, IconDeviceMobile, IconTrash, IconParking,
} from '@tabler/icons-react'
import type { ComponentType } from 'react'

type IconCmp = ComponentType<{ size?: number; stroke?: number; className?: string }>

const ICONS: Record<string, IconCmp> = {
  bolt: IconBolt, building: IconBuilding, car: IconCar, checklist: IconChecklist, droplet: IconDroplet,
  flame: IconFlame, home: IconHome, receipt: IconReceipt, shield: IconShield, tool: IconTool,
  wifi: IconWifi, phone: IconDeviceMobile, trash: IconTrash, parking: IconParking,
}

// Keep in sync with worker/icons.py
const KEYWORDS: [RegExp, string][] = [
  [/חשמל/, 'bolt'],
  [/מים|תאגיד/, 'droplet'],
  [/גז/, 'flame'],
  [/אינטרנט|בזק|הוט|hot|סיבים/i, 'wifi'],
  [/פרטנר|סלקום|פלאפון|גולן|טלפון|סלולר/i, 'phone'],
  [/ועד/, 'building'],
  [/ארנונה|עירייה|עיריית/, 'receipt'],
  [/ביטוח/, 'shield'],
  [/טסט|רכב|רישיון|מוסך/, 'car'],
  [/חניה|חנייה/, 'parking'],
  [/תיקון|לתקן|ברז|אינסטלטור|חשמלאי/, 'tool'],
  [/זבל|פח/, 'trash'],
]

export function iconFor(title: string): string {
  return KEYWORDS.find(([re]) => re.test(title))?.[1] ?? 'checklist'
}

export function TaskIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Cmp = ICONS[name] ?? IconChecklist
  return <Cmp size={size} stroke={1.75} />
}
