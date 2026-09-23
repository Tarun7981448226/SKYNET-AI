"""add public_ask_rate_limit table

Revision ID: e2a4c8f19d6b
Revises: b7e4d1a9c3f5
Create Date: 2026-09-21 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'e2a4c8f19d6b'
down_revision = 'b7e4d1a9c3f5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'public_ask_rate_limit',
        sa.Column('ip', sa.String(), primary_key=True),
        sa.Column('window_start', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('count', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    op.drop_table('public_ask_rate_limit')
