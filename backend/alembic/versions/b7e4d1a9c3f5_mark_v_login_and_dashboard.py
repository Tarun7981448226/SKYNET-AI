"""mark v: webauthn credentials, job user_decision, tailored_resume drive_link

Revision ID: b7e4d1a9c3f5
Revises: a1f3c9d7e0b2
Create Date: 2026-09-18 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'b7e4d1a9c3f5'
down_revision = 'a1f3c9d7e0b2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'webauthn_credentials',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('credential_id', sa.String(), nullable=False, unique=True),
        sa.Column('public_key', sa.String(), nullable=False),
        sa.Column('sign_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('transports', sa.JSON(), nullable=True),
        sa.Column('label', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.add_column('jobs', sa.Column('user_decision', sa.String(), nullable=True))
    op.add_column('tailored_resumes', sa.Column('drive_link', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('tailored_resumes', 'drive_link')
    op.drop_column('jobs', 'user_decision')
    op.drop_table('webauthn_credentials')
