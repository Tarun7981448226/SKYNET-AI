"""add domain to jobs

Revision ID: a1f3c9d7e0b2
Revises: 10ca6a6aad48
Create Date: 2026-09-18 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'a1f3c9d7e0b2'
down_revision = '10ca6a6aad48'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('jobs', sa.Column('domain', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('jobs', 'domain')
