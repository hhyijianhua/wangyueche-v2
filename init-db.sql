-- ===============================================
-- 信途网约车租赁管理系统 - Supabase 建表脚本
-- 使用方法：
--  1. 打开 https://supabase.com/dashboard/project/wphfpqpcpcllxcjmjtqa/sql/new
--  2. 把本文件全部内容粘贴进去
--  3. 点右下角「Run」或按 Ctrl+Enter
--  4. 看到 "Success. No rows returned" 就成功了
-- ===============================================

-- 1. 启用 UUID 扩展
create extension if not exists "pgcrypto";

-- ===============================================
-- 2. 车辆主表 vehicles
-- ===============================================
create table if not exists public.vehicles (
    id uuid primary key default gen_random_uuid(),
    plate_no text not null unique,
    model text,
    color text,
    vin text,
    owner_name text,
    owner_phone text,
    owner_id_card text,
    remark text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ===============================================
-- 3. 租赁信息表 rentals（一台车一条最新记录）
-- ===============================================
create table if not exists public.rentals (
    id uuid primary key default gen_random_uuid(),
    vehicle_id uuid not null references public.vehicles(id) on delete cascade,
    driver_name text,
    driver_phone text,
    driver_id_card text,
    start_date date,
    monthly_rent numeric(12,2) default 0,
    deposit numeric(12,2) default 0,
    next_pay_date date,
    contract_no text,
    remark text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(vehicle_id)
);

-- ===============================================
-- 4. 保险信息表 insurance
-- ===============================================
create table if not exists public.insurance (
    id uuid primary key default gen_random_uuid(),
    vehicle_id uuid not null references public.vehicles(id) on delete cascade,
    company text,
    policy_no text,
    start_date date,
    end_date date,
    amount numeric(12,2) default 0,
    remark text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(vehicle_id)
);

-- ===============================================
-- 5. 证件图片表 documents（每台车最多 6 张槽位）
-- ===============================================
create table if not exists public.documents (
    id uuid primary key default gen_random_uuid(),
    vehicle_id uuid not null references public.vehicles(id) on delete cascade,
    slot text not null,
    storage_path text,
    public_url text,
    file_name text,
    file_size bigint default 0,
    mime_type text,
    created_at timestamptz not null default now(),
    unique(vehicle_id, slot)
);

-- 如果表已存在时补列（安全写法 IF NOT EXISTS）
alter table public.documents add column if not exists mime_type text;

-- 槽位说明：owner_id_front / owner_id_back / driver_id_front / driver_id_back / driver_license_front / driver_license_back

-- ===============================================
-- 6. 开启 RLS（行级安全），单用户场景直接全开
-- ===============================================
alter table public.vehicles    enable row level security;
alter table public.rentals     enable row level security;
alter table public.insurance   enable row level security;
alter table public.documents   enable row level security;

-- 给匿名用户（anon key 前端使用的用户）全部读写权限
drop policy if exists "vehicles_all"  on public.vehicles;
drop policy if exists "rentals_all"   on public.rentals;
drop policy if exists "insurance_all" on public.insurance;
drop policy if exists "documents_all" on public.documents;

create policy "vehicles_all"  on public.vehicles    for all using (true) with check (true);
create policy "rentals_all"   on public.rentals     for all using (true) with check (true);
create policy "insurance_all" on public.insurance   for all using (true) with check (true);
create policy "documents_all" on public.documents   for all using (true) with check (true);

-- ===============================================
-- 7. 自动更新 updated_at 触发器
-- ===============================================
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists set_vehicles_updated_at  on public.vehicles;
drop trigger if exists set_rentals_updated_at   on public.rentals;
drop trigger if exists set_insurance_updated_at on public.insurance;
drop trigger if exists set_documents_updated_at on public.documents;

create trigger set_vehicles_updated_at  before update on public.vehicles    for each row execute function public.handle_updated_at();
create trigger set_rentals_updated_at   before update on public.rentals     for each row execute function public.handle_updated_at();
create trigger set_insurance_updated_at before update on public.insurance   for each row execute function public.handle_updated_at();
create trigger set_documents_updated_at before update on public.documents   for each row execute function public.handle_updated_at();

-- ===============================================
-- 8. Storage 存储桶（证件图片）的权限
--    注意：存储桶需要在 Supabase 面板手动创建一次（点菜单 Storage → Create new bucket → 名字 wyc-documents → 打勾 Public 公开）
--    或者直接运行下面这一句（需要是超级用户，service role 权限，anon 可能不行，不行就手动去面板建）
-- ===============================================
-- insert into storage.buckets (id, name, public) values ('wyc-documents', 'wyc-documents', true)
-- on conflict (id) do nothing;

-- 存储桶读写权限（公开读，登录/匿名都能写）
-- 建完桶之后手动在 Storage → wyc-documents → Policies 加两条：
--   1) SELECT (读): public, 允许任何人
--   2) INSERT (写): public, 允许任何人
--   3) DELETE (删): public, 允许任何人
-- 或者直接执行下面两句（需要 service role 权限）：
-- create policy "wyc_docs_del"   on storage.objects for delete using (bucket_id = 'wyc-documents');
-- create policy "wyc_docs_write" on storage.objects for insert with check (bucket_id = 'wyc-documents');

-- ===============================================
-- 9. 显式授权（Supabase 新版建表后默认没有 grant，会报 permission denied，即使 RLS policy 全开也没用）
--    这一段一定要执行，否则前端 anon key 连表都看不到 / 写不了
-- ===============================================
grant usage on schema public to postgres, anon, authenticated, service_role;

grant all privileges on all tables in schema public to postgres, anon, authenticated, service_role;
grant all privileges on all sequences in schema public to postgres, anon, authenticated, service_role;
grant all privileges on all functions in schema public to postgres, anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;

-- 如果上面 9 条执行完，前端 anon key 就能正常 select/insert/update/delete 四张表了
-- 如果还报错，把下面这句也执行一下（兜底）：
-- grant postgres to CURRENT_USER;
