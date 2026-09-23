"""mark vi: push_subscriptions table for web push notifications

Revision ID: 5f39d68646d3
Revises: f6b1d3a7c9e4
Create Date: 2026-09-23 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '5f39d68646d3'
down_revision = 'f6b1d3a7c9e4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'push_subscriptions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('endpoint', sa.String(), nullable=False, unique=True),
        sa.Column('p256dh', sa.String(), nullable=False),
        sa.Column('auth', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('push_subscriptions')
