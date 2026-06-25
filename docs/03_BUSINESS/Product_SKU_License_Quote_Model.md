# Product SKU, License & Quote Model

## Product Catalog 계층

```text
Vendor
 └── Product Family
      └── Product
           └── Edition
                └── SKU
                     └── License Metric
```

## SANGFOR Product Family Seed 예시

SANGFOR 공식 제품군은 Cybersecurity와 Cloud/Infrastructure 영역으로 나눌 수 있다. 문서의 seed는 실제 가격표가 아니며, 내부 테스트용 모델이다.

| Family | 예시 제품 |
|---|---|
| Cybersecurity | NGFW, Endpoint Secure/EPP, SWG, NDR, XDR, MDR, SASE |
| Cloud & Infrastructure | HCI, VDI/aDesk, Cloud Platform, Kubernetes Engine, aStor |

## SKU 필드

```text
product_skus
- id
- vendor_id
- product_family_id
- product_id
- sku_code
- name
- edition
- license_metric: device | user | endpoint | core | node | throughput | subscription
- term_months
- deployment_type: appliance | virtual | cloud | managed_service
- list_price
- base_cost
- currency
- status
```

## Sizing Template

제품군마다 discovery와 sizing 기준이 다르다.

### NGFW/SASE/SWG

- 회선 수
- 트래픽 규모
- 사용자 수
- VPN 사용자
- 보안 정책 수
- 로그 보존 기간
- HA 요구사항

### EPP/XDR/MDR

- endpoint 수
- OS 종류
- 기존 보안 솔루션
- SOC 운영 여부
- 대응 프로세스
- 규제 요구사항

### HCI/VDI

- 서버 수
- VM 수
- CPU/RAM/storage
- IOPS
- 백업/DR 요구
- 기존 VMware/Hyper-V 환경
- 사용자 프로필

## Quote Engine

Quote는 다음 라인아이템으로 구성한다.

```text
Product Line Item
Service Line Item
Discount Line Item
Expense Line Item
Support/Maintenance Line Item
```

## 마진 계산

```text
revenue = 총 판매가
cost = 제품 매입가 + 서비스 원가 + 출장비 + 지원 원가
gross_margin = revenue - cost
margin_percent = gross_margin / revenue * 100
```

## Commercial Gate Rule 예시

| 조건 | 처리 |
|---|---|
| margin < 15% | CEO 승인 필요 |
| discount > 25% | Finance + CEO 승인 |
| service cost missing | auto_failed |
| unknown SKU | auto_failed |
| vendor special discount pending | ready 불가 |
| payment term unusual | Finance review |

## Quote Versioning

고객에게 보낸 모든 견적은 immutable version으로 저장한다.

```text
quote_v1_draft
quote_v2_finance_review
quote_v3_customer_sent
quote_v4_revised
```
