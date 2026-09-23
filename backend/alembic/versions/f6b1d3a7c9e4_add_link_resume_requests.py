"""add link_resume_requests table

Revision ID: f6b1d3a7c9e4
Revises: e2a4c8f19d6b
Create Date: 2026-09-21 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'f6b1d3a7c9e4'
down_revision = 'e2a4c8f19d6b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'link_resume_requests',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('url', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='pending'),
        sa.Column('job_id', sa.Integer(), sa.ForeignKey('jobs.id'), nullable=True),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('drive_link', sa.String(), nullable=True),
        sa.Column('whatsapp_status', sa.String(), nullable=True),
        sa.Column('error', sa.String(), nullable=True),
        sa.Column('requested_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('link_resume_requests')
