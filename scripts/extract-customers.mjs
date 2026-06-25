// 메일에서 고객/파트너 데이터 추출 스크립트

import { readFileSync, writeFileSync } from 'fs'

// Mail Intelligence에서 메일 가져오기
const response = await fetch('http://localhost:3010/api/outlook/messages')
const data = await response.json()
const messages = data.messages || []

console.log(`총 ${messages.length}개 메일 분석 중...`)

// 고객 데이터 추출
const customers = new Map()
const partners = new Map()

for (const msg of messages) {
  const from = msg.from || ''
  const fromName = msg.fromName || ''
  const subject = msg.subject || ''
  const body = msg.body || ''
  
  // Sangfor 관련 → 파트너
  if (from.includes('sangfor.com') || subject.includes('Sangfor')) {
    if (!partners.has('sangfor')) {
      partners.set('sangfor', {
        name: 'Sangfor',
        email: from,
        contactName: fromName,
        type: 'vendor',
        products: ['HCI', 'SCP', 'NGAF', 'VPN'],
        status: 'active'
      })
    }
  }
  
  // 1AN 관련 → 파트너
  if (from.includes('1an.kr') || subject.includes('일에이엔')) {
    if (!partners.has('1an')) {
      partners.set('1an', {
        name: '일에이엔 (1AN)',
        email: from,
        contactName: fromName,
        type: 'partner',
        products: ['네트워크', '보안'],
        status: 'active'
      })
    }
  }
  
  // 고객사 추출 (메일 본문에서 회사명 추출)
  const companyPatterns = [
    /고객사[:\s]+([^\n]+)/g,
    /회사명[:\s]+([^\n]+)/g,
    /고객[:\s]+([^\n]+)/g,
    /Customer[:\s]+([^\n]+)/gi,
  ]
  
  for (const pattern of companyPatterns) {
    const matches = body.matchAll(pattern)
    for (const match of matches) {
      const companyName = match[1].trim()
      if (companyName && !customers.has(companyName)) {
        customers.set(companyName, {
          name: companyName,
          email: from,
          contactName: fromName,
          subject: subject,
          status: 'active'
        })
      }
    }
  }
  
  // 이메일 도메인에서 회사 추출
  const emailDomain = from.split('@')[1]
  if (emailDomain && !emailDomain.includes('sangfor.com') && !emailDomain.includes('1an.kr')) {
    const companyName = emailDomain.split('.')[0]
    if (!customers.has(companyName)) {
      customers.set(companyName, {
        name: companyName,
        email: from,
        contactName: fromName,
        subject: subject,
        status: 'active'
      })
    }
  }
}

// 결과 출력
console.log('\n=== 추출된 고객 데이터 ===')
const customerList = Array.from(customers.values())
console.log(JSON.stringify(customerList, null, 2))

console.log('\n=== 추출된 파트너 데이터 ===')
const partnerList = Array.from(partners.values())
console.log(JSON.stringify(partnerList, null, 2))

// 파일로 저장
const result = {
  customers: customerList,
  partners: partnerList,
  extractedAt: new Date().toISOString()
}

writeFileSync('/Users/jmpark/Documents/Playground/AIOSv2_integration/extracted-data.json', JSON.stringify(result, null, 2))
console.log('\n✅ extracted-data.json 파일로 저장 완료')
