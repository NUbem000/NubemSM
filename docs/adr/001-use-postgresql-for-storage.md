# ADR-001: Use PostgreSQL for Storage

## Status
Accepted

## Context
We need a reliable database to store speed test results with the following requirements:
- Time-series data support
- ACID compliance
- Good performance for analytical queries
- Integration with Grafana
- Open source

## Decision
We will use PostgreSQL as our primary database.

## Consequences
### Positive
- Excellent time-series support with TimescaleDB extension option
- Native JSON support for flexible schema
- Mature ecosystem and tooling
- Direct Grafana integration
- Built-in replication and backup features

### Negative
- More resource intensive than SQLite
- Requires separate container/process
- Need to manage connections properly

## Alternatives Considered
- SQLite: Too limited for concurrent writes
- InfluxDB: Overkill for our use case
- MySQL: Less feature-rich for our needs