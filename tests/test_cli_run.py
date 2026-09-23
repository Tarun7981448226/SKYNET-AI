import argparse
from unittest.mock import patch

from app.cli import cmd_jobs_summary, cmd_test_alerts


def test_cmd_jobs_summary_generates_fresh_by_default():
    with patch("app.summary.generate_morning_summary", return_value={"total_jobs": 0}) as gen_mock:
        cmd_jobs_summary(argparse.Namespace(cached=False))

    assert gen_mock.called


def test_cmd_jobs_summary_uses_cached_when_requested():
    with (
        patch("app.summary.load_latest_summary", return_value={"total_jobs": 1}) as cached_mock,
        patch("app.summary.generate_morning_summary") as gen_mock,
    ):
        cmd_jobs_summary(argparse.Namespace(cached=True))

    assert cached_mock.called
    assert not gen_mock.called


def test_cmd_test_alerts_sends_both_alert_types():
    with (
        patch("app.alerts.send_error_alert") as error_mock,
        patch("app.alerts.send_success_alert") as success_mock,
    ):
        cmd_test_alerts(argparse.Namespace())

    assert error_mock.called
    assert success_mock.called
