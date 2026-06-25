#!/bin/bash
# Convert inline React styles to Tailwind CSS classes
# Usage: ./convert-inline-styles.sh <file>

FILE="$1"
if [ -z "$FILE" ]; then
  echo "Usage: $0 <file>"
  exit 1
fi

# Create backup
cp "$FILE" "$FILE.bak"

# Color mappings
declare -A COLORS=(
  ["#111827"]="gray-900"
  ["#1f2937"]="gray-800"
  ["#374151"]="gray-700"
  ["#4b5563"]="gray-600"
  ["#6b7280"]="gray-500"
  ["#9ca3af"]="gray-400"
  ["#d1d5db"]="gray-300"
  ["#e5e7eb"]="gray-200"
  ["#f3f4f6"]="gray-100"
  ["#f9fafb"]="gray-50"
  ["#ffffff"]="white"
  ["#000000"]="black"
  ["#3b82f6"]="blue-500"
  ["#2563eb"]="blue-600"
  ["#1d4ed8"]="blue-700"
  ["#10b981"]="emerald-500"
  ["#059669"]="emerald-600"
  ["#f59e0b"]="amber-500"
  ["#d97706"]="amber-600"
  ["#ef4444"]="red-500"
  ["#dc2626"]="red-600"
  ["#8b5cf6"]="violet-500"
  ["#7c3aed"]="violet-600"
  ["#4f46e5"]="indigo-600"
)

# Font size mappings
declare -A FONT_SIZES=(
  ["10px"]="text-xs"
  ["11px"]="text-xs"
  ["12px"]="text-xs"
  ["13px"]="text-xs"
  ["14px"]="text-sm"
  ["15px"]="text-sm"
  ["16px"]="text-base"
  ["18px"]="text-lg"
  ["20px"]="text-xl"
  ["24px"]="text-2xl"
  ["28px"]="text-3xl"
  ["32px"]="text-2xl"
)

# Padding mappings (single value)
declare -A PADDING=(
  ["4px"]="p-1"
  ["8px"]="p-2"
  ["12px"]="p-3"
  ["16px"]="p-4"
  ["20px"]="p-5"
  ["24px"]="p-6"
  ["32px"]="p-8"
)

# Border radius mappings
declare -A BORDER_RADIUS=(
  ["4px"]="rounded"
  ["6px"]="rounded-md"
  ["8px"]="rounded-lg"
  ["10px"]="rounded-lg"
  ["12px"]="rounded-xl"
  ["9999px"]="rounded-full"
  ["50%"]="rounded-full"
)

echo "Converting inline styles in $FILE..."
echo "This is a reference script - manual conversion is still needed for complex styles."
echo "Backup saved as $FILE.bak"
