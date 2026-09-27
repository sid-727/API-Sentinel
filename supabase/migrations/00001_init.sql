-- Supabase Database Migration
-- Phase 1: Initialize API Shield Schema
-- Location: supabase/migrations/00001_init.sql

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create Tenants Table
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    api_key_hash TEXT NOT NULL UNIQUE,
    rate_limit_rpm INT NOT NULL DEFAULT 60,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create Tenant Members Table (for dashboard users mapping to tenants)
CREATE TABLE IF NOT EXISTS tenant_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL, -- references auth.users(id) in live supabase context
    role TEXT NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, user_id)
);

-- 4. Create Telemetry Logs Table
CREATE TABLE IF NOT EXISTS telemetry_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    request_path TEXT NOT NULL,
    request_method TEXT NOT NULL,
    prompt TEXT,
    response TEXT,
    tokens_prompt INT NOT NULL DEFAULT 0,
    tokens_completion INT NOT NULL DEFAULT 0,
    tokens_total INT NOT NULL DEFAULT 0,
    cost_usd NUMERIC(12, 8) NOT NULL DEFAULT 0.00000000,
    latency_ms INT NOT NULL,
    status_code INT NOT NULL,
    is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    blocked_by TEXT, -- 'layer_1', 'layer_2', etc.
    threat_type TEXT,
    confidence NUMERIC(3, 2)
);

-- 5. Indexes for Ultra-Fast Query Execution
-- Index telemetry logs on tenant_id and created_at DESC for paginated/dashboard queries
CREATE INDEX IF NOT EXISTS idx_telemetry_logs_tenant_created 
ON telemetry_logs (tenant_id, created_at DESC);

-- Index tenants on api_key_hash for rapid authentication checks in proxy
CREATE INDEX IF NOT EXISTS idx_tenants_api_key_hash 
ON tenants (api_key_hash);

-- 6. Enforce Supabase Row Level Security (RLS)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_logs ENABLE ROW LEVEL SECURITY;

-- 7. Define RLS Policies for Multi-Tenant Isolation

-- Tenants Table Policies
CREATE POLICY "Users can select tenants they belong to" ON tenants
    FOR SELECT
    USING (
        id IN (
            SELECT tenant_id 
            FROM tenant_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update tenants they belong to as admin" ON tenants
    FOR UPDATE
    USING (
        id IN (
            SELECT tenant_id 
            FROM tenant_members 
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- Tenant Members Policies
CREATE POLICY "Users can view members of their tenant" ON tenant_members
    FOR SELECT
    USING (
        tenant_id IN (
            SELECT tenant_id 
            FROM tenant_members 
            WHERE user_id = auth.uid()
        )
    );

-- Telemetry Logs Policies
CREATE POLICY "Users can view telemetry logs of their tenant" ON telemetry_logs
    FOR SELECT
    USING (
        tenant_id IN (
            SELECT tenant_id 
            FROM tenant_members 
            WHERE user_id = auth.uid()
        )
    );

-- Note: The Edge proxy utilizes the Supabase Service Role client to authenticate API keys 
-- and write logs asynchronously, bypassing RLS to perform core telemetry logging safely.
